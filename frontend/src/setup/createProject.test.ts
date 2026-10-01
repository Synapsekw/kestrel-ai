import { beforeEach, describe, expect, it } from "vitest";
import { ApiFailure } from "@/api/errors";
import { errorBody, exampleProject, fakeClient } from "@/test/fixtures";
import { VERTICAL, VERTICAL_HOTKEYS, VERTICAL_IDS, setupRoutes, typeSpec } from "@/test/setupFixtures";
import { createFromDraft } from "./createProject";
import { draftSnapshot, useSetupDraft } from "./draftStore";

const created = { method: "POST", path: /\/projects$/, status: 201, body: exampleProject };

describe("createFromDraft (the S-R5 placeholder U6 replaces)", () => {
  beforeEach(() => {
    useSetupDraft.getState().discard();
    useSetupDraft.getState().setName(" Mast ");
    useSetupDraft.getState().setFolder("E:\\Projects\\Mast");
  });

  it("ensures the types, then creates the project with their ids and hotkeys", async () => {
    useSetupDraft.getState().chooseTemplate(VERTICAL, "replace");
    const { api, requests } = fakeClient(setupRoutes([created]));
    expect((await createFromDraft(api, draftSnapshot())).id).toBe(exampleProject.id);
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST /api/v1/catalogue/types/ensure",
      "POST /api/v1/projects",
    ]);
    expect(requests[0].body).toEqual({ types: VERTICAL.config.types });
    expect(requests[1].body).toEqual({
      name: "Mast",
      folder: "E:\\Projects\\Mast",
      type_ids: VERTICAL_IDS,
      hotkeys: VERTICAL_HOTKEYS,
    });
  });

  it("creates with no ensure and no hotkeys when there are no types", async () => {
    const { api, requests } = fakeClient(setupRoutes([created]));
    await createFromDraft(api, draftSnapshot());
    expect(requests.map((r) => r.url)).toEqual(["/api/v1/projects"]);
    expect(requests[0].body).toEqual({ name: "Mast", folder: "E:\\Projects\\Mast", type_ids: [] });
  });

  it("stops before creating when ensure fails", async () => {
    useSetupDraft.getState().addType(typeSpec("Rust", "defect", 2, "1"));
    const { api, requests } = fakeClient(
      setupRoutes([
        {
          method: "POST",
          path: /\/catalogue\/types\/ensure$/,
          status: 503,
          body: errorBody("catalogue_unavailable", "catalogue.db could not be opened"),
        },
        created,
      ]),
    );
    await expect(createFromDraft(api, draftSnapshot())).rejects.toBeInstanceOf(ApiFailure);
    expect(requests.some((r) => r.url === "/api/v1/projects")).toBe(false);
  });

  it("never sends an id twice and drops one the server could not resolve", async () => {
    useSetupDraft.getState().addType(typeSpec("Rust", "defect", 2, "1"));
    useSetupDraft.getState().addType(typeSpec("Rust streak", "defect", 2, null));
    useSetupDraft.getState().addType(typeSpec("Dent", "defect", 1, "2"));
    const { api, requests } = fakeClient(
      setupRoutes([
        {
          method: "POST",
          path: /\/catalogue\/types\/ensure$/,
          body: {
            items: [
              { name: "Rust", id: "t-rust", created: true, conflict: null },
              { name: "Rust streak", id: "t-rust", created: false, conflict: null },
              { name: "Dent", id: null, created: false, conflict: null },
            ],
          },
        },
        created,
      ]),
    );
    await createFromDraft(api, draftSnapshot());
    expect(requests[1].body).toMatchObject({ type_ids: ["t-rust"], hotkeys: { "t-rust": "1" } });
  });
});
