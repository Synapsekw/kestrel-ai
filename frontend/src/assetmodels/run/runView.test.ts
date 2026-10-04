import { describe, expect, it } from "vitest";
import type { AssetModelRun } from "@contract/client";
import { DEFAULT_MAX_STEPS, maxSteps, stepShare, stepText } from "./runView";

const steps = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ n: i + 1, tool: "t", ok: true, summary: "", has_thumb: false }));

describe("the run's step budget (spec §11)", () => {
  it("a build or refine run counts against M1's 80", () => {
    expect(maxSteps({ mode: "build" })).toBe(DEFAULT_MAX_STEPS);
    expect(maxSteps({ mode: "refine" })).toBe(DEFAULT_MAX_STEPS);
    expect(stepText({ mode: "refine", steps: steps(12) })).toBe("step 12 of 80");
    expect(stepShare({ mode: "build", steps: steps(40) })).toBe(0.5);
    expect(stepText({ mode: "build", steps: steps(95) })).toBe("step 80 of 80");
  });

  it("a plant run has no step budget: a plain count and an indeterminate bar", () => {
    for (const mode of ["plant", "plant_package"] as AssetModelRun["mode"][]) {
      const run = { mode, steps: steps(7) };
      expect(maxSteps(run)).toBeNull();
      expect(stepText(run)).toBe("step 7");
      expect(stepShare(run)).toBeUndefined();
    }
  });
});
