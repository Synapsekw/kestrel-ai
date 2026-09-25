import { describe, expect, it } from "vitest";
import type { Job } from "@contract/client";
import { runningJob } from "@/test/fixtures";
import { jobToastText } from "@/ui";
import { jobTitle, resultTarget } from "./jobLabels";

/** The six job types of the point-cloud, volumes and design specs (foundation F0). */
const NEW: [Job["type"], string, string][] = [
  ["pointcloud_import", "Point cloud import", "/p/p/clouds"],
  ["pointcloud_export", "Point cloud export", "/p/p/clouds"],
  ["surface_build", "Build surface", "/p/p/volumes"],
  ["volume_calc", "Calculate volume", "/p/p/volumes"],
  ["volume_export", "Export volumes", "/p/p/volumes"],
  ["design_import", "Design surface import", "/p/p/volumes"],
];

describe("the new job types", () => {
  it.each(NEW)("%s is titled %s and links to its screen", (type, label, to) => {
    const job = { ...runningJob, type, params: {} };
    expect(jobTitle(job)).toBe(label);
    expect(resultTarget({ ...job, state: "succeeded" }, "p")?.to).toBe(to);
  });

  it.each(NEW)("%s has a failure toast that names it", (type, label) => {
    const job = { ...runningJob, type, state: "failed" as const, error: "not implemented" };
    expect(jobToastText(job)).toBe(`${label} failed: not implemented`);
  });

  it("names the design import's phase when it succeeds", () => {
    const done = { ...runningJob, type: "design_import" as const, state: "succeeded" as const };
    expect(jobToastText({ ...done, params: { phase: "inspect" } })).toBe("Design file read");
    expect(jobToastText({ ...done, params: { phase: "preview" } })).toBe("Design preview ready");
    expect(jobToastText({ ...done, params: { phase: "build" } })).toBe("Design surface imported");
  });
});
