import { describe, it, expect } from "vitest";
import {
  errorBody,
  exampleSource,
  exampleStats,
  fakeClient,
  PROJECT_ID,
  runningJob,
  SOURCE_ID,
} from "@/test/fixtures";
import {
  createSource,
  fetchAllSources,
  fetchRunsBySource,
  fetchSourceStats,
  updateMapDate,
  updateSource,
} from "./sources";

describe("sources api", () => {
  it("lists every page, reads stats and starts an import", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/sources$/, body: { items: [exampleSource], next_cursor: "string" } },
      { method: "GET", path: /\/sources\/[^/]+\/stats$/, body: exampleStats },
      { method: "POST", path: /\/sources$/, status: 202, body: { source: exampleSource, job: runningJob } },
    ]);
    expect((await fetchAllSources(api, PROJECT_ID)).map((s) => s.site)).toEqual(["ahmadia"]);
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/sources?limit=1000`);
    expect((await fetchSourceStats(api, PROJECT_ID, SOURCE_ID)).unlabeled_count).toBe(3269);
    const body = {
      folder: "E:\\Dev\\Yolo\\Ahmadia Construction Data",
      site: "ahmadia",
      settings: { max_side: 3000, quality: 95, dedupe_threshold: 4, group_regex: "^(?P<flight>\\d+)" },
    };
    const started = await createSource(api, PROJECT_ID, body);
    expect(started.job.id).toBe(runningJob.id);
    expect(requests.at(-1)).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/sources`,
      body,
    });
  });

  it("patches a source's label and survey date, and a map without a source by the map", async () => {
    const { api, requests } = fakeClient([
      {
        method: "PATCH",
        path: /\/sources\/[^/]+$/,
        body: { ...exampleSource, captured_on: "2026-09-14", label: "Flight 14 Sep" },
      },
      { method: "PATCH", path: /\/maps\/[^/]+$/, body: { id: "m1", captured_on: null } },
    ]);
    const out = await updateSource(api, PROJECT_ID, SOURCE_ID, { captured_on: "2026-09-14" });
    expect(out.captured_on).toBe("2026-09-14");
    expect(requests[0]).toMatchObject({
      method: "PATCH",
      url: `/api/v1/projects/${PROJECT_ID}/sources/${SOURCE_ID}`,
      body: { captured_on: "2026-09-14" },
    });
    await updateMapDate(api, PROJECT_ID, "m1", null);
    expect(requests[1]).toMatchObject({
      method: "PATCH",
      url: `/api/v1/projects/${PROJECT_ID}/maps/m1`,
      body: { captured_on: null },
    });
  });

  it("picks each source's pinned run, else its newest, from one bounded page", async () => {
    const run = (id: string, source_id: string | null, pinned = false) => ({ id, source_id, pinned });
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/runs$/,
        body: {
          items: [
            run("new-a", "a"),
            run("old-a", "a", true),
            run("new-b", "b"),
            run("old-b", "b"),
            run("x", null),
          ],
          next_cursor: "more",
        },
      },
    ]);
    const bySource = await fetchRunsBySource(api, PROJECT_ID);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/runs?limit=200`);
    expect(bySource.get("a")?.id).toBe("old-a");
    expect(bySource.get("b")?.id).toBe("new-b");
    expect(bySource.size).toBe(2);
  });

  it("surfaces 501 until S1 lands", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/sources$/, status: 501, body: errorBody("not_implemented", "S1 later") },
    ]);
    await expect(fetchAllSources(api, PROJECT_ID)).rejects.toMatchObject({
      code: "not_implemented",
      status: 501,
    });
  });
});
