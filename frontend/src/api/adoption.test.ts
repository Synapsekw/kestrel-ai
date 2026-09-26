import { describe, expect, it } from "vitest";
import { exampleProject, fakeClient, MAP_ID, PROJECT_ID, runningJob } from "@/test/fixtures";
import {
  createDetectionProject,
  fetchAdoption,
  fetchDetectionProjects,
  moveMap,
  retryAdoption,
} from "./adoption";

const TARGET_ID = "7f1c2e3a-1111-4000-8000-000000000009";

describe("adoption api", () => {
  it("reads the adoption status and retries it", async () => {
    const status = { pending: 1, adopted: 2, missing: [], job_id: null };
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/adoption$/, body: status },
      { method: "POST", path: /\/adoption\/retry$/, status: 202, body: { job: runningJob } },
    ]);
    expect(await fetchAdoption(api, PROJECT_ID)).toEqual(status);
    expect(await retryAdoption(api, PROJECT_ID)).toEqual(runningJob);
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET /api/v1/projects/${PROJECT_ID}/adoption`,
      `POST /api/v1/projects/${PROJECT_ID}/adoption/retry`,
    ]);
  });

  it("moves a map into a target project and returns the target's job", async () => {
    const job = { ...runningJob, project_id: TARGET_ID, type: "map_move" as const };
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/maps\/[^/]+\/move$/, status: 202, body: { job } },
    ]);
    expect(await moveMap(api, PROJECT_ID, MAP_ID, TARGET_ID)).toEqual(job);
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/maps/${MAP_ID}/move`,
      body: { target_project_id: TARGET_ID },
    });
  });

  it("lists only detection projects and creates one without classes", async () => {
    const detect = { ...exampleProject, id: TARGET_ID, name: "North site", kind: "detect" as const };
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/projects$/, body: { items: [exampleProject, detect], next_cursor: null } },
      { method: "POST", path: /\/projects$/, status: 201, body: detect },
    ]);
    expect(await fetchDetectionProjects(api)).toEqual([detect]);
    expect(await createDetectionProject(api, "North site", "E:/Projects/North")).toEqual(detect);
    expect(requests[1].body).toEqual({
      name: "North site",
      folder: "E:/Projects/North",
      type_ids: [],
      kind: "detect",
      classes: [],
    });
  });
});
