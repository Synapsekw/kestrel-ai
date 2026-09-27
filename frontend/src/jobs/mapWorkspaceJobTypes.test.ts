import { describe, expect, it } from "vitest";
import type { Job } from "@contract/client";
import { JOB_VERB } from "@/app/jobVerbs";
import { runningJob } from "@/test/fixtures";
import { jobToastText } from "@/ui";
import { jobTitle, resultTarget } from "./jobLabels";

/** The two job types of the map workspace (spec 2026-09-26-map-workspace §12, unit M-C0). */
const NEW: [Job["type"], string, string][] = [
  ["elevation_import", "Elevation import", "/p/p/maps"],
  ["drawing_import", "Drawing import", "/p/p/maps"],
];

describe("the map-workspace job types", () => {
  it.each(NEW)("%s is titled %s and links to the map", (type, label, to) => {
    const job = { ...runningJob, type, params: {} };
    expect(jobTitle(job)).toBe(label);
    expect(resultTarget({ ...job, state: "succeeded" }, "p")?.to).toBe(to);
    expect(JOB_VERB[type]).toMatch(/^Importing /);
  });

  it.each(NEW)("%s has a failure toast that names it", (type, label) => {
    const job = {
      ...runningJob,
      type,
      state: "failed" as const,
      error: "no coordinates",
    };
    expect(jobToastText(job)).toBe(`${label} failed: no coordinates`);
  });

  it("names the drawing import's phase when it succeeds", () => {
    const done = {
      ...runningJob,
      type: "drawing_import" as const,
      state: "succeeded" as const,
    };
    expect(jobToastText({ ...done, params: { phase: "inspect" } })).toBe("Drawing file read");
    expect(jobToastText({ ...done, params: { phase: "build" } })).toBe("Drawing imported");
    expect(
      jobToastText({
        ...runningJob,
        type: "elevation_import",
        state: "succeeded",
      }),
    ).toBe("Elevation imported");
  });
});
