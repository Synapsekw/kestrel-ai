import { describe, expect, it } from "vitest";
import { deepestLevelAt, pickUncertainty, type NodeBox } from "./uncertainty";

describe("pick uncertainty", () => {
  it("halves the root spacing per level", () => {
    expect(pickUncertainty(4, 0)).toBe(4);
    expect(pickUncertainty(4, 7)).toBeCloseTo(0.03125, 12);
    expect(pickUncertainty(4.13, 3)).toBeCloseTo(0.51625, 12);
  });

  it("takes the deepest visible node that contains the pick", () => {
    const nodes: NodeBox[] = [
      { level: 0, min: [0, 0, 0], max: [100, 100, 100] },
      { level: 2, min: [0, 0, 0], max: [25, 25, 25] },
      { level: 5, min: [50, 50, 50], max: [53.125, 53.125, 53.125] },
    ];
    expect(deepestLevelAt(nodes, { x: 10, y: 10, z: 10 })).toBe(2);
    expect(deepestLevelAt(nodes, { x: 51, y: 52, z: 53 })).toBe(5);
    expect(deepestLevelAt(nodes, { x: 60, y: 60, z: 60 })).toBe(0);
    expect(deepestLevelAt(nodes, { x: -1, y: 0, z: 0 })).toBeNull();
  });
});
