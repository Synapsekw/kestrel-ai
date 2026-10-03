import { describe, expect, it } from "vitest";
import type { Job } from "@contract/client";
import { JOB_VERB } from "@/app/jobVerbs";
import { runningJob } from "@/test/fixtures";
import { jobToastText } from "@/ui";
import { jobTitle, resultTarget } from "./jobLabels";

/** The five asset findings job types (spec 2026-10-02-asset-findings §6, plan af-c0). */
const job = (type: Job["type"], params: Record<string, unknown> = { asset_model_id: "m1" }): Job => ({
  ...runningJob,
  type,
  params,
});

const TYPES = ["asset_glb_import", "asset_pose", "asset_place", "asset_group", "review_kit_import"] as const;

describe("the asset findings job types", () => {
  it.each([
    ["asset_glb_import", "GLB import", "Importing a GLB", "GLB imported as a new version"],
    ["asset_pose", "Photo poses", "Estimating photo poses", "Photo poses estimated"],
    ["asset_place", "Sighting placement", "Placing sightings", "Placements computed"],
    ["asset_group", "Sighting grouping", "Grouping sightings", "Findings regrouped"],
    ["review_kit_import", "Review import", "Importing a review", "Review job imported"],
  ] as const)("%s is titled, phrased and toasted", (type, title, verb, toast) => {
    expect(jobTitle(job(type))).toBe(title);
    expect(JOB_VERB[type]).toBe(verb);
    expect(jobToastText({ ...job(type), state: "succeeded" })).toBe(toast);
  });

  it("links to the asset model when it succeeds", () => {
    for (const type of TYPES) {
      expect(resultTarget({ ...job(type), state: "succeeded" }, "p")).toEqual({
        label: "Open asset model",
        to: "/p/p/models/m1",
      });
    }
    const fromResult = {
      ...job("asset_place", {}),
      state: "succeeded" as const,
      result: { asset_model_id: "m2" },
    };
    expect(resultTarget(fromResult, "p")?.to).toBe("/p/p/models/m2");
    expect(resultTarget({ ...job("asset_group", {}), state: "succeeded" }, "p")?.to).toBe("/p/p/models");
  });

  it("treats a review dry run as a check, not an import", () => {
    const dry = { ...job("review_kit_import", { dry_run: true }), state: "succeeded" as const };
    expect(jobToastText(dry)).toBe("Review folder checked");
    expect(resultTarget(dry, "p")).toBeNull();
  });

  it("names the job in a failure toast", () => {
    expect(jobToastText({ ...job("asset_place"), state: "failed", error: "The GLB has no faces" })).toBe(
      "Placement failed: The GLB has no faces",
    );
  });
});
