// src/assetmodels/review/outcome.test.ts
import { describe, expect, it } from "vitest";
import type { CameraPose } from "@/assetmodels/viewer/cameras";
import { filterPoses, isContext, outcomeColours, outcomeCounts, outcomeKey, sequencesOf } from "./outcome";

const pose = (id: string, outcome: string | null, sequence: string | null = "A"): CameraPose => ({
  imageId: id,
  position: [0, 0, 0],
  target: [1, 0, 0],
  up: [0, 1, 0],
  hfovDeg: 70,
  vfovDeg: 50,
  sequence,
  outcome,
});

describe("photo outcomes", () => {
  it("keys and context", () => {
    expect(outcomeKey("finding")).toBe("finding");
    expect(outcomeKey(null)).toBe("unreviewed");
    expect(outcomeKey("something else")).toBe("unreviewed");
    expect(isContext("uncertain")).toBe(false);
    expect(isContext("none")).toBe(true);
    expect(isContext("not_assessed")).toBe(true);
    expect(isContext(null)).toBe(true);
  });

  it("colours come from the theme tokens", () => {
    const read = (t: string): [number, number, number] => (t === "danger" ? [255, 138, 160] : [1, 2, 3]);
    const c = outcomeColours(read);
    expect(c.finding).toBe("rgb(255, 138, 160)");
    expect(c.none).toBe("rgb(1, 2, 3)");
  });

  it("filters by sequence and leaves context photos out unless asked", () => {
    const all = [
      pose("a", "finding", "A"),
      pose("b", "none", "A"),
      pose("c", "uncertain", "B"),
      pose("d", null, null),
    ];
    expect(filterPoses(all, { sequence: null, includeContext: false }).map((p) => p.imageId)).toEqual([
      "a",
      "c",
    ]);
    expect(filterPoses(all, { sequence: null, includeContext: true }).map((p) => p.imageId)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(filterPoses(all, { sequence: "A", includeContext: true }).map((p) => p.imageId)).toEqual([
      "a",
      "b",
    ]);
    expect(outcomeCounts(all)).toEqual({ finding: 1, uncertain: 1, none: 1, not_assessed: 0, unreviewed: 1 });
    expect(sequencesOf(all)).toEqual(["A", "B"]);
  });
});
