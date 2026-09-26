import { describe, expect, it } from "vitest";
import type { Job } from "@contract/client";
import { runningJob } from "@/test/fixtures";
import { jobTitle, resultTarget } from "./jobLabels";

const done = (patch: Partial<Job>): Job => ({
  ...runningJob,
  params: {},
  result: null,
  ...patch,
  state: "succeeded",
});

describe("result links after the Models and Catalogue sections (F §5.3)", () => {
  it.each<[Partial<Job>, { label: string; to: string }]>([
    [
      { type: "train", result: { model_id: "m1" } },
      { label: "Open model", to: "/models/library?model=m1" },
    ],
    [
      { type: "library_import", result: { model_id: "m1" } },
      { label: "Open model", to: "/models/library?model=m1" },
    ],
    [{ type: "library_adopt" }, { label: "Open library", to: "/models/library" }],
    [
      { type: "dataset_build", result: { dataset_id: "d1" } },
      { label: "Open dataset", to: "/models/datasets/d1" },
    ],
    [
      { type: "dataset", params: { dataset_id: "d1" } },
      { label: "Open dataset", to: "/models/datasets/d1" },
    ],
    [{ type: "dataset" }, { label: "Open datasets", to: "/models/datasets" }],
    [{ type: "findings_backfill" }, { label: "Open catalogue", to: "/catalogue" }],
    [{ type: "project_migrate" }, { label: "Open projects", to: "/projects" }],
    [{ type: "findings_recount" }, { label: "Open findings", to: "/p/p/findings" }],
  ])("%o links to %o", (patch, target) => {
    expect(resultTarget(done(patch), "p")).toEqual(target);
  });

  it("titles the foundation job types", () => {
    expect(jobTitle({ ...runningJob, type: "dataset_build", params: { name: "machines-v1" } })).toBe(
      "Dataset build: machines-v1",
    );
    expect(jobTitle({ ...runningJob, type: "dataset", params: {} })).toBe("Dataset export");
    expect(jobTitle({ ...runningJob, type: "project_migrate", params: {} })).toBe("Project upgrade");
    expect(jobTitle({ ...runningJob, type: "findings_backfill", params: {} })).toBe(
      "Findings from annotations",
    );
    expect(jobTitle({ ...runningJob, type: "findings_recount", params: {} })).toBe("Findings recount");
  });
});
