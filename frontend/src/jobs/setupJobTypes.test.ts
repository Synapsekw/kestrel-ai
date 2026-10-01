import { describe, expect, it } from "vitest";
import { runningJob } from "@/test/fixtures";
import { JOB_VERB } from "@/app/jobVerbs";
import { jobToastText, reportedInline } from "@/ui";
import { jobTitle, resultTarget } from "./jobLabels";

/** The project-setup inspect job (spec 2026-09-30-project-setup §7, unit S1-U1): a library job. */
const job = {
  ...runningJob,
  project_id: "library",
  type: "setup_inspect" as const,
  params: { paths: ["E:\\Deliveries\\Tower 14"], template_id: "builtin-vertical" },
};

describe("the setup_inspect job", () => {
  it("is titled and phrased", () => {
    expect(jobTitle(job)).toBe("Sort dropped files");
    expect(JOB_VERB.setup_inspect).toBe("Sorting files");
  });

  it("links back to the new-project page when it succeeds", () => {
    expect(resultTarget({ ...job, state: "succeeded" }, "library")).toEqual({
      label: "Open new project",
      to: "/projects/new",
    });
  });

  it("toasts its outcome, except on the page that shows it", () => {
    expect(jobToastText({ ...job, state: "succeeded" })).toBe("Dropped files sorted");
    expect(jobToastText({ ...job, state: "failed", error: "Access is denied" })).toBe(
      "Sort dropped files failed: Access is denied",
    );
    expect(reportedInline({ ...job, state: "succeeded" }, "/projects/new")).toBe(true);
    expect(reportedInline({ ...job, state: "succeeded" }, "/projects")).toBe(false);
  });
});
