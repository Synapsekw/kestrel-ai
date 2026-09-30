import { describe, expect, it } from "vitest";
import { runningJob } from "@/test/fixtures";
import { JOB_VERB } from "@/app/jobVerbs";
import { jobToastText } from "@/ui";
import { jobTitle, resultTarget } from "./jobLabels";

/** The Reports render job (spec 2026-09-26-reports §14, unit R0; params and result per plan R5). */
const job = {
  ...runningJob,
  type: "report_render" as const,
  params: { report_id: "r1", version_id: "v1", formats: ["pdf"], label: null },
};

describe("the report_render job", () => {
  it("is titled and phrased", () => {
    expect(jobTitle(job)).toBe("Report");
    expect(JOB_VERB.report_render).toBe("Rendering a report");
  });

  it("links to its report when it succeeds", () => {
    expect(resultTarget({ ...job, state: "succeeded" }, "p")).toEqual({
      label: "Open report",
      to: "/p/p/reports/r1",
    });
    expect(resultTarget({ ...job, state: "succeeded", params: {} }, "p")?.to).toBe("/p/p/reports");
  });

  it("toasts its outcome", () => {
    expect(jobToastText({ ...job, state: "succeeded" })).toBe("Report rendered");
    expect(jobToastText({ ...job, state: "failed", error: "The disk is full" })).toBe(
      "Report failed: The disk is full",
    );
  });
});
