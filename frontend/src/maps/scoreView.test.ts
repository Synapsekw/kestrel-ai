import { describe, expect, it } from "vitest";
import { exampleLabel, exampleMapScore } from "@/test/fixtures";
import { matchLookup, mistakes, pct, signed } from "./scoreView";

describe("score view", () => {
  it("looks up a box's match by kind", () => {
    const det = matchLookup(exampleMapScore, "detection")!;
    expect(det("d1")).toBe("tp");
    expect(det("d2")).toBe("fp");
    expect(det(exampleLabel.id)).toBeUndefined();
    expect(matchLookup(exampleMapScore, "label")!(exampleLabel.id)).toBe("fn");
    expect(matchLookup(null, "label")).toBeUndefined();
  });

  it("lists only the mistakes, in reading order", () => {
    expect(mistakes(exampleMapScore).map((m) => m.id)).toEqual(["d2", exampleLabel.id]);
  });

  it("formats percentages and signed counts", () => {
    expect(pct(0.857)).toBe("85.7 %");
    expect(pct(null)).toBe("—");
    expect(signed(-1)).toBe("−1");
    expect(signed(3)).toBe("+3");
    expect(signed(0)).toBe("0");
  });
});
