import { describe, it, expect } from "vitest";
import { fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { createDetectExport } from "./detectExports";

describe("detect exports api", () => {
  it("posts the format and source and returns the job", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/detect-exports$/,
        status: 202,
        body: { job: { ...runningJob, type: "detect_export" } },
      },
    ]);
    const job = await createDetectExport(api, PROJECT_ID, { format: "pdf", source_id: "s1" });
    expect(job.type).toBe("detect_export");
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/detect-exports`,
      body: { format: "pdf", source_id: "s1" },
    });
  });
});
