import { beforeEach, describe, expect, it, vi } from "vitest";
import { useJobsStore } from "@/store/jobs";
import {
  errorBody,
  exampleProject,
  exampleSource,
  fakeClient,
  runningJob,
  type FakeRoute,
  type RecordedRequest,
} from "@/test/fixtures";
import { bucket, draft, draftType, heldClient, PHOTOS } from "@/test/setupDispatchFixtures";
import { runSetup, slotImports, useSetupImports } from "./dispatch";

const P = exampleProject.id;
const TYPES = [draftType("Corrosion", "1"), draftType("Bird nest", "5", { kind: "object" })];
const D = draft({
  types: TYPES,
  buckets: [
    bucket({ route: "images", match: { thermal: false }, slot_key: "visual" }),
    bucket({ route: "images", match: { thermal: true }, slot_key: "thermal" }),
  ],
});
const ensured = (created: boolean) => ({
  items: TYPES.map((t, i) => ({ name: t.name, id: `t${i + 1}`, created, conflict: null })),
});
const ENSURE: FakeRoute = { method: "POST", path: /\/catalogue\/types\/ensure$/, body: ensured(true) };
const CREATE: FakeRoute = { method: "POST", path: /\/projects$/, status: 201, body: exampleProject };
const SOURCES: FakeRoute = {
  method: "POST",
  path: /\/sources$/,
  status: 202,
  body: { source: exampleSource, job: runningJob },
};
const posts = (requests: RecordedRequest[]) => requests.filter((r) => r.method === "POST").map((r) => r.url);
const states = () => slotImports(useSetupImports.getState().byProject[P]).map((s) => s.state);

beforeEach(() => {
  useSetupImports.setState({ byProject: {} });
  useJobsStore.setState({ jobs: {} });
});

describe("runSetup", () => {
  it("ensures the types, creates the project with their ids and hotkeys, then imports the shared folder once", async () => {
    const { api, requests } = fakeClient([ENSURE, CREATE, SOURCES]);
    await expect(runSetup(api, D)).resolves.toEqual({ projectId: P });
    await vi.waitFor(() => expect(states()).toEqual(["started", "started"]));
    expect(posts(requests)).toEqual([
      "/api/v1/catalogue/types/ensure",
      "/api/v1/projects",
      `/api/v1/projects/${P}/sources`,
    ]);
    const ensureBody = requests[0].body as { types: Record<string, unknown>[]; dry_run?: boolean };
    expect(ensureBody.dry_run).toBeUndefined();
    expect(ensureBody.types.map((t) => t.name)).toEqual(["Corrosion", "Bird nest"]);
    expect(ensureBody.types.every((t) => !("key" in t))).toBe(true);
    expect(requests[1].body).toEqual({
      name: "Tower 14",
      folder: "E:\\Projects\\Tower 14",
      type_ids: ["t1", "t2"],
      hotkeys: { t1: "1", t2: "5" },
    });
    expect(requests[2].body).toEqual({ folder: PHOTOS });
    expect(useJobsStore.getState().jobs[runningJob.id]).toBeDefined();
  });

  it("creates a project with no types without calling ensure", async () => {
    const { api, requests } = fakeClient([CREATE, SOURCES]);
    await runSetup(api, { ...D, types: [] });
    expect(requests[0]).toMatchObject({
      url: "/api/v1/projects",
      body: { name: "Tower 14", folder: "E:\\Projects\\Tower 14", type_ids: [] },
    });
    expect(requests[0].body).not.toHaveProperty("hotkeys");
  });

  it("creates nothing when ensure fails", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/catalogue\/types\/ensure$/,
        status: 503,
        body: errorBody("catalogue_unavailable", "the catalogue is unavailable"),
      },
      CREATE,
      SOURCES,
    ]);
    await expect(runSetup(api, D)).rejects.toThrow("the catalogue is unavailable");
    expect(posts(requests)).toEqual(["/api/v1/catalogue/types/ensure"]);
    expect(useSetupImports.getState().byProject).toEqual({});
  });

  it("names the refused type when ensure answers 422 with details.name", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/catalogue\/types\/ensure$/,
        status: 422,
        body: errorBody("invalid_severity_rule", "Severity 7 is not on the scale.", {
          type_index: 1,
          name: "Bird nest",
        }),
      },
      CREATE,
      SOURCES,
    ]);
    await expect(runSetup(api, D)).rejects.toMatchObject({
      message: "Bird nest: Severity 7 is not on the scale.",
      code: "invalid_severity_rule",
      status: 422,
      details: { type_index: 1, name: "Bird nest" },
    });
    expect(posts(requests)).toEqual(["/api/v1/catalogue/types/ensure"]);
  });

  it("keeps the ensured types when POST /projects fails, and a second Create sends the same ids", async () => {
    let ensures = 0;
    let creates = 0;
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/catalogue\/types\/ensure$/, body: () => ensured(++ensures === 1) },
      {
        method: "POST",
        path: /\/projects$/,
        status: () => (++creates === 1 ? 409 : 201),
        body: () =>
          creates === 1 ? errorBody("project_exists", "this folder already holds a project") : exampleProject,
      },
      SOURCES,
    ]);
    await expect(runSetup(api, D)).rejects.toThrow("this folder already holds a project");
    expect(posts(requests)).toEqual(["/api/v1/catalogue/types/ensure", "/api/v1/projects"]);
    expect(useSetupImports.getState().byProject).toEqual({});

    await expect(runSetup(api, D)).resolves.toEqual({ projectId: P });
    const created = requests.filter((r) => r.url === "/api/v1/projects").map((r) => r.body);
    expect(created).toHaveLength(2);
    expect(created[1]).toEqual(created[0]);
    expect(requests.some((r) => /\/catalogue\/types$/.test(r.url))).toBe(false);
  });

  it("keeps starting the imports after runSetup returned, with nothing mounted", async () => {
    const { api, requests, release } = heldClient([ENSURE, CREATE, SOURCES], /\/sources$/);
    await expect(runSetup(api, D)).resolves.toEqual({ projectId: P });
    expect(states()).toEqual(["pending", "pending"]);
    release();
    await vi.waitFor(() => expect(states()).toEqual(["started", "started"]));
    expect(requests.filter((r) => r.url.endsWith("/sources"))).toHaveLength(1);
  });
});
