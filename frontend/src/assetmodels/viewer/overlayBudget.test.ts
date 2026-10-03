import { describe, expect, it } from "vitest";
import { buildOverlayGrid, gatherVisiblePoints, markVisibleCells } from "./overlayBudget";

function maskFor(boxes: number): Uint8Array {
  return new Uint8Array(Math.ceil(boxes / 8));
}

describe("scan overlay budget", () => {
  it("keeps every point, without rewriting the caller's buffer", () => {
    const points = new Float32Array([0.1, 0.1, 0.1, 1.5, 0.1, 0.1, 0.1, 1.5, 0.1, 0.1, 0.1, 1.5, 2, 2, 2]);
    const snapshot = points.slice();
    const grid = buildOverlayGrid(points, 2);

    expect(points).toEqual(snapshot);
    expect(grid.boxes).toHaveLength(8);
    const back = new Float32Array(points.length);
    const mask = maskFor(grid.boxes.length);
    mask.fill(0xff);
    const count = gatherVisiblePoints(grid, mask, 100, back);

    expect(count).toBe(5);
    const got = [...back.subarray(0, count * 3)];
    expect(got.sort((a, b) => a - b)).toEqual([...snapshot].sort((a, b) => a - b));
  });

  it("hides a cell that sits fully behind a clip plane", () => {
    const points = new Float32Array([0, 0, 0, 0, 0, 10]);
    const grid = buildOverlayGrid(points, 2);
    const mask = maskFor(grid.boxes.length);
    // Plane z = 6. The cell holding (0,0,0) ends at z = 5; the cell holding (0,0,10) starts at z = 5.
    markVisibleCells(grid, [{ nx: 0, ny: 0, nz: 1, c: -6 }], mask);

    expect(mask[0] & 1).toBe(0);
    expect(mask[0] & (1 << 4)).toBe(1 << 4);
  });

  it("splits a tight budget across visible cells instead of emptying the first", () => {
    const near = Array.from({ length: 10 }, () => [0.1, 0, 0]).flat();
    const far = Array.from({ length: 10 }, () => [1.5, 0, 0]).flat();
    const grid = buildOverlayGrid(new Float32Array([...near, ...far]), 2);
    const mask = maskFor(grid.boxes.length);
    mask.fill(0xff);
    const into = new Float32Array(12);
    const count = gatherVisiblePoints(grid, mask, 4, into);

    expect(count).toBe(4);
    expect(into[0]).toBeLessThan(1);
    expect(into[3]).toBeLessThan(1);
    expect(into[6]).toBeGreaterThan(1);
    expect(into[9]).toBeGreaterThan(1);
  });

  it("fills the budget from a dense cell when its neighbour is short", () => {
    const one = [0.1, 0, 0];
    const many = Array.from({ length: 10 }, () => [1.5, 0, 0]).flat();
    const grid = buildOverlayGrid(new Float32Array([...one, ...many]), 2);
    const mask = maskFor(grid.boxes.length);
    mask.fill(0xff);
    const into = new Float32Array(12);
    const count = gatherVisiblePoints(grid, mask, 4, into);

    expect(count).toBe(4);
    const xs = [into[0], into[3], into[6], into[9]];
    expect(xs.filter((x) => x < 1)).toHaveLength(1);
    expect(xs.filter((x) => x > 1)).toHaveLength(3);
  });

  it("draws at most the budget from a full-size scan", () => {
    const n = 300_000;
    const points = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      points[i * 3] = (i % 100) / 10;
      points[i * 3 + 1] = (((i / 100) | 0) % 100) / 10;
      points[i * 3 + 2] = (((i / 10000) | 0) % 30) / 10;
    }
    const built = performance.now();
    const grid = buildOverlayGrid(points);
    const buildMs = performance.now() - built;
    const mask = maskFor(grid.boxes.length);
    mask.fill(0xff);
    const into = new Float32Array(32_000 * 3);
    const gathered = performance.now();
    const count = gatherVisiblePoints(grid, mask, 32_000, into);
    const gatherMs = performance.now() - gathered;

    expect(count).toBe(32_000);
    expect(buildMs).toBeLessThan(500);
    expect(gatherMs).toBeLessThan(30);
  });
});
