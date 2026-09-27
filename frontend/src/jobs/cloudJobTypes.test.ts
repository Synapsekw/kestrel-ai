import { describe, expect, it } from "vitest";
import { runningJob } from "@/test/fixtures";
import { JOB_VERB } from "@/app/jobVerbs";
import { jobToastText } from "@/ui";
import { jobTitle, resultTarget } from "./jobLabels";

/** The job type of the point-cloud workspace (spec 2026-09-26 section 12 row 14, unit C-C0). */
const job = {
  ...runningJob,
  type: "pointcloud_profile" as const,
  params: { cloud_id: "c1", measurement_id: "m1" },
};

describe("the pointcloud_profile job", () => {
  it("is titled and phrased", () => {
    expect(jobTitle(job)).toBe("Cross-section profile");
    expect(JOB_VERB.pointcloud_profile).toBe("Cutting a cross-section profile");
  });

  it("links to its cloud when it succeeds", () => {
    expect(resultTarget({ ...job, state: "succeeded" }, "p")).toEqual({
      label: "Open point cloud",
      to: "/p/p/clouds/c1",
    });
    expect(resultTarget({ ...job, state: "succeeded", params: {} }, "p")?.to).toBe("/p/p/clouds");
  });

  it("toasts its outcome", () => {
    expect(jobToastText({ ...job, state: "succeeded" })).toBe("Cross-section profile ready");
    expect(jobToastText({ ...job, state: "failed", error: "the source file changed" })).toBe(
      "Cross-section profile failed: the source file changed",
    );
  });
});
