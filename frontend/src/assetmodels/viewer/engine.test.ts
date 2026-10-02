import { describe, expect, it } from "vitest";
import { partsFromScene, viewDirection } from "./engine";

describe("model engine pure helpers", () => {
  it("views match the backend rasterizer", () => {
    expect(viewDirection("front")).toEqual([1, 0, 0]);
    expect(viewDirection("side")).toEqual([0, 0, 1]);
    expect(viewDirection("top")).toEqual([0, -1, 0]);
    const iso = viewDirection("iso");
    expect(Math.hypot(...iso)).toBeCloseTo(1);
  });

  it("reads parts from node extras, skipping nodes without them", () => {
    const nodes = [
      { name: "shell", userData: { name: "Shell", group: "Shell" } },
      { name: "N7", userData: { name: "Nozzle N7", group: "Nozzle" } },
      { name: "Scene", userData: {} },
    ];
    const root = { traverse: (cb: (o: unknown) => void) => nodes.forEach(cb) };
    expect(partsFromScene(root)).toEqual([
      { id: "shell", name: "Shell", group: "Shell" },
      { id: "N7", name: "Nozzle N7", group: "Nozzle" },
    ]);
  });
});
