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
import { createSource, fetchAllSources, fetchSourceStats } from "./sources";

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
