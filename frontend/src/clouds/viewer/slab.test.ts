import { Matrix4 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SLAB_INTERVAL_MS, sliceSlab, slabNodes, throttleLatest, type SlabNode } from "./slab";

/** One node: float32 local positions, placed by a float64 translation (the octree's UTM offset). */
function node(local: number[][], offset: [number, number, number], rgb = true): SlabNode {
  const position = new Float32Array(local.flat());
  const rgba = new Uint8Array(local.length * 4);
  local.forEach((_, i) => rgba.set([10 * i, 20, 30, 255], 4 * i));
  return {
    position,
    count: local.length,
    matrix: new Matrix4().makeTranslation(...offset).elements,
    rgba: rgb ? rgba : null,
  };
}

const O: [number, number, number] = [243500, 3178000, 100];

describe("sliceSlab", () => {
  it("keeps |t| <= thickness/2 (inclusive) and 0 <= s <= |b - a|, in float64 at UTM offsets", () => {
    const n = node(
      [
        [0.001, 0.5, 1], // s = 0.001, t = 0.5 - 0.5 = 0 -> in
        [5, 0.75, 2], // t = +0.25 -> exactly half the thickness (exact in float32): in
        [5, 0.875, 3], // t = +0.375 -> out
        [-0.001, 0.5, 4], // s < 0 -> out
        [10, 0.5, 5], // s = |b - a| -> in
        [10.002, 0.5, 6], // past b -> out
      ],
      O,
    );
    const a: [number, number, number] = [O[0], O[1] + 0.5, 0];
    const b: [number, number, number] = [O[0] + 10, O[1] + 0.5, 0];
    const r = sliceSlab([n], a, b, 0.5);
    expect(r.total).toBe(3);
    expect(r.count).toBe(3);
    expect([...r.s]).toEqual([expect.closeTo(0.001, 6), expect.closeTo(5, 6), expect.closeTo(10, 6)]);
    expect([...r.z]).toEqual([101, 102, 105]);
    expect([...r.rgb!]).toEqual([0, 20, 30, 10, 20, 30, 40, 20, 30]);
    expect(r.a).toEqual(a);
    expect(r.thicknessM).toBe(0.5);
  });

  it("thins to maxPoints by keeping every k-th match", () => {
    const local = Array.from({ length: 1000 }, (_, i) => [i * 0.01, 0, 0]);
    const r = sliceSlab([node(local, [0, 0, 0])], [0, 0, 0], [20, 0, 0], 1, 300);
    expect(r.total).toBe(1000);
    expect(r.count).toBeLessThanOrEqual(300);
    expect(r.count).toBe(Math.ceil(1000 / Math.ceil(1000 / 300)));
    expect(r.s[0]).toBeCloseTo(0, 6);
  });

  it("answers an empty sample for a zero-length line or a zero thickness", () => {
    const n = node([[0, 0, 0]], [0, 0, 0]);
    expect(sliceSlab([n], [1, 1, 0], [1, 1, 5], 1).count).toBe(0);
    expect(sliceSlab([n], [0, 0, 0], [1, 0, 0], 0).count).toBe(0);
  });

  it("has no colour when a node has none", () => {
    const r = sliceSlab([node([[0.5, 0, 0]], [0, 0, 0], false)], [0, 0, 0], [1, 0, 0], 1);
    expect(r.count).toBe(1);
    expect(r.rgb).toBeNull();
  });
});

describe("slabNodes", () => {
  it("reads the visible nodes' position and rgba arrays and world matrices", () => {
    const m = new Matrix4().makeTranslation(1, 2, 3);
    const position = { array: new Float32Array([0, 0, 0]), count: 1 };
    const rgba = { array: new Uint8Array([1, 2, 3, 255]) };
    const pco = {
      visibleNodes: [
        { sceneNode: { matrixWorld: m, geometry: { attributes: { position, rgba } } } },
        { sceneNode: null },
      ],
    };
    const nodes = slabNodes(pco as never);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].count).toBe(1);
    expect(nodes[0].rgba).toBe(rgba.array);
    expect(nodes[0].matrix[12]).toBe(1);
  });
});

describe("throttleLatest", () => {
  afterEach(() => vi.useRealTimers());
  const clock = () => ({ now: () => Date.now(), later: (fn: () => void, ms: number) => setTimeout(fn, ms) });

  it("runs the first call at once and folds calls inside the window into one trailing run", async () => {
    vi.useFakeTimers();
    const run = vi.fn((x: number) => x * 2);
    const t = throttleLatest(run, SLAB_INTERVAL_MS, clock());
    await expect(t(1)).resolves.toBe(2);
    const p2 = t(2);
    const p3 = t(3);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SLAB_INTERVAL_MS);
    await expect(p2).resolves.toBe(6);
    await expect(p3).resolves.toBe(6);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith(3);
  });

  it("passes a failure to every waiter", async () => {
    vi.useFakeTimers();
    const t = throttleLatest(
      () => {
        throw new Error("boom");
      },
      SLAB_INTERVAL_MS,
      clock(),
    );
    await expect(t()).rejects.toThrow("boom");
  });
});
