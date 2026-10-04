import { describe, expect, it } from "vitest";
import { confidenceLabel, packageStateLabel } from "./labels";

describe("panel labels", () => {
  it("names every confidence in sentence case", () => {
    expect(confidenceLabel("high")).toBe("High");
    expect(confidenceLabel("medium")).toBe("Medium");
    expect(confidenceLabel("low")).toBe("Low");
    expect(confidenceLabel("very_low")).toBe("Very low");
  });

  it("names every package state in plain words", () => {
    expect(packageStateLabel("queued")).toBe("Waiting");
    expect(packageStateLabel("running")).toBe("Running");
    expect(packageStateLabel("done")).toBe("Done");
    expect(packageStateLabel("failed")).toBe("Failed");
    expect(packageStateLabel("skipped")).toBe("Skipped");
    expect(packageStateLabel("on_hold")).toBe("On hold");
  });
});
