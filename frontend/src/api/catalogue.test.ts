import { describe, expect, it } from "vitest";
import { errorBody, fakeClient, runningJob } from "@/test/fixtures";
import { exampleSeverity, exampleTypes, TYPE_ID } from "@/test/appSectionFixtures";
import {
  createCatalogueType,
  existingTypeId,
  fetchCatalogue,
  fetchSeverityScale,
  finishClassification,
  isCatalogueUnavailable,
  isHotkeyConflict,
  patchCatalogueType,
  saveSeverityScale,
  severityInUse,
  startBackfill,
  unavailableFolder,
} from "./catalogue";

const NEW_TYPE = {
  name: "dump-truck",
  colour: "#06b6d4",
  kind: "object" as const,
  default_severity: null,
  hotkey: null,
  group: null,
};

describe("fetchCatalogue", () => {
  it("follows the cursor, keeps archived types and reads the flag from the first page", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/api\/v1\/catalogue\/types$/,
        body: (req) =>
          req.url.includes("cursor=p2")
            ? { items: exampleTypes.slice(2), next_cursor: null, needs_classification: false }
            : { items: exampleTypes.slice(0, 2), next_cursor: "p2", needs_classification: true },
      },
    ]);
    const list = await fetchCatalogue(api);
    expect(list.types.map((t) => t.name)).toEqual(["Excavator", "Dump truck", "Crack", "Spalling"]);
    expect(list.needsClassification).toBe(true);
    expect(requests[0].url).toContain("include_archived=true");
    expect(requests[0].url).toContain("limit=500");
  });

  it("stops when a cursor repeats (the Prism mock answers the same cursor forever)", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        body: { items: exampleTypes, next_cursor: "string", needs_classification: false },
      },
    ]);
    const list = await fetchCatalogue(api);
    expect(list.types).toHaveLength(4);
    expect(requests).toHaveLength(2);
  });
});

describe("catalogue writes", () => {
  it("patches one type and returns the backfill flag", async () => {
    const { api, requests } = fakeClient([
      {
        method: "PATCH",
        path: /\/catalogue\/types\/[^/]+$/,
        body: { ...exampleTypes[0], kind: "defect", backfill_candidates: true },
      },
    ]);
    const saved = await patchCatalogueType(api, TYPE_ID(1), { kind: "defect" });
    expect(saved.backfill_candidates).toBe(true);
    expect(requests[0].url).toBe(`/api/v1/catalogue/types/${TYPE_ID(1)}`);
    expect(requests[0].body).toEqual({ kind: "defect" });
  });

  it("starts the backfill and returns its job", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/backfill$/,
        status: 202,
        body: { job: { ...runningJob, type: "findings_backfill" } },
      },
    ]);
    expect((await startBackfill(api, TYPE_ID(1))).type).toBe("findings_backfill");
  });

  it("reads and saves the whole severity scale", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/catalogue\/severity$/, body: { levels: exampleSeverity } },
      { method: "PUT", path: /\/catalogue\/severity$/, body: { levels: exampleSeverity } },
    ]);
    expect(await fetchSeverityScale(api)).toEqual(exampleSeverity);
    await saveSeverityScale(api, exampleSeverity);
    expect(requests[1].body).toEqual({ levels: exampleSeverity });
  });

  it("marks the classification as done", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/catalogue\/classification\/done$/, status: 204 },
    ]);
    await finishClassification(api);
    expect(requests[0].method).toBe("POST");
  });
});

describe("catalogue error helpers", () => {
  it("reads the existing id from type_exists", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/catalogue\/types$/,
        status: 409,
        body: errorBody("type_exists", "Dump truck already exists", { type_id: TYPE_ID(2) }),
      },
    ]);
    const err = await createCatalogueType(api, NEW_TYPE).catch((e: unknown) => e);
    expect(existingTypeId(err)).toBe(TYPE_ID(2));
    expect(isHotkeyConflict(err)).toBe(false);
  });

  it("reads the level and the project names from severity_in_use", async () => {
    const { api } = fakeClient([
      {
        method: "PUT",
        path: /\/catalogue\/severity$/,
        status: 409,
        body: errorBody("severity_in_use", "level 4 is in use", {
          level: 4,
          projects: ["Ahmadia", "Bridge A"],
        }),
      },
    ]);
    const err = await saveSeverityScale(api, exampleSeverity.slice(0, 3)).catch((e: unknown) => e);
    expect(severityInUse(err)).toEqual({ level: 4, projects: ["Ahmadia", "Bridge A"] });
  });

  it("recognises the 503 and its folder", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        status: 503,
        body: errorBody("catalogue_unavailable", "catalogue.db is locked", {
          folder: "C:\\Users\\D\\AppData\\Roaming\\kestrel-ai\\library",
        }),
      },
    ]);
    const err = await fetchCatalogue(api).catch((e: unknown) => e);
    expect(isCatalogueUnavailable(err)).toBe(true);
    expect(unavailableFolder(err)).toBe("C:\\Users\\D\\AppData\\Roaming\\kestrel-ai\\library");
  });
});
