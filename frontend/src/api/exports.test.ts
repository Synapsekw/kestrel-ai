import { describe, it, expect } from "vitest";
import { fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { createResultsExport, revealInExplorer } from "./exports";

describe("exports api", () => {
  it("posts the export request and returns the job", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/exports$/,
        status: 202,
        body: { job: { ...runningJob, type: "results_export" } },
      },
    ]);
    const job = await createResultsExport(api, PROJECT_ID, {
      formats: ["csv", "html"],
      include_unreviewed: true,
    });
    expect(job.type).toBe("results_export");
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/exports`,
      body: { formats: ["csv", "html"], include_unreviewed: true },
    });
  });

  it("posts the folder to reveal and resolves on 204", async () => {
    const { api, requests } = fakeClient([{ method: "POST", path: /\/reveal$/, status: 204 }]);
    await expect(revealInExplorer(api, PROJECT_ID, "exports/2026-09-19_101500")).resolves.toBeUndefined();
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/reveal`,
      body: { path: "exports/2026-09-19_101500" },
    });
  });
});
