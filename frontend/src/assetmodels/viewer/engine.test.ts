import { describe, expect, it } from "vitest";
import {
  AUTO_ROTATE_SPEED,
  GHOST_OPACITY,
  GROUND_RENDER_ORDER,
  PATCH_ALPHA_TEST,
  PATCH_POLYGON_OFFSET,
  PATCH_RENDER_ORDER,
  partsFromScene,
  viewDirection,
} from "./engine";

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

  it("keys parts by the resolved raw id, so ids with dots round-trip", () => {
    const nodes = [{ name: "N1_2", userData: { name: "Nozzle", group: "Nozzle" }, raw: "N1.2" }];
    const root = { traverse: (cb: (o: unknown) => void) => nodes.forEach(cb) };
    expect(partsFromScene(root, (o: { raw: string }) => o.raw)).toEqual([
      { id: "N1.2", name: "Nozzle", group: "Nozzle" },
    ]);
  });
});

describe("engine constants follow the kit", () => {
  it("draws patches, ghost and ground as the kit does", () => {
    expect(PATCH_ALPHA_TEST).toBe(0.3);
    expect(PATCH_POLYGON_OFFSET).toBe(-4);
    expect(PATCH_RENDER_ORDER).toBe(3);
    expect(GHOST_OPACITY).toBe(0.25);
    expect(GROUND_RENDER_ORDER).toBe(-10);
    expect(AUTO_ROTATE_SPEED).toBe(0.6);
  });
});
