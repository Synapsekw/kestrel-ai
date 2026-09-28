import * as THREE from "three";
import { PointCloudOctreePicker } from "potree-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickWindowPixels } from "./pickAll";

type Fn = (...args: unknown[]) => unknown;
const statics = PointCloudOctreePicker as unknown as Record<"findHit" | "getPickPoint" | "nodesOnRay", Fn>;
const saved = { ...statics };

describe("pickWindowPixels", () => {
  beforeEach(() => {
    // stand-ins for potree's statics: this test checks the wrapping, not potree's maths
    statics.findHit = vi.fn(() => null);
    statics.getPickPoint = vi.fn(() => null);
    statics.nodesOnRay = vi.fn(() => ["the ray's nodes"]);
  });
  afterEach(() => {
    statics.findHit = saved.findHit;
    statics.getPickPoint = saved.getPickPoint;
    statics.nodesOnRay = saved.nodesOnRay;
  });

  it("renders the chosen nodes, keeps the raw window, and restores the statics", () => {
    const chosen = [{ id: "a" }, { id: "b" }];
    const pixels = new Uint8Array(4 * 2 * 2);
    pixels[3] = 2; // node index 1 drawn at pixel 0
    let seenNodes: unknown = null;
    let seenParams: Record<string, unknown> | null = null;
    const findHit = statics.findHit;
    const pco = {
      pick: vi.fn((_r: unknown, _c: unknown, ray: unknown, params: Record<string, unknown>) => {
        seenParams = params;
        seenNodes = statics.nodesOnRay(pco, ray);
        const hit = statics.findHit(pixels, 2);
        statics.getPickPoint(hit, [{ node: chosen[0] }, { node: chosen[1] }]);
        return null;
      }),
    };
    const onBeforePickRender = vi.fn();
    const got = pickWindowPixels(
      pco as never,
      {} as THREE.WebGLRenderer,
      new THREE.PerspectiveCamera(),
      new THREE.Ray(),
      {
        windowSize: 2,
        pixel: new THREE.Vector3(10, 20, 0),
        nodes: chosen as never,
        params: { onBeforePickRender },
      },
    );
    expect(seenNodes).toBe(chosen);
    expect(seenParams).toMatchObject({ pickWindowSize: 2, onBeforePickRender });
    expect((seenParams as unknown as { pixelPosition: THREE.Vector3 }).pixelPosition.toArray()).toEqual([
      10, 20, 0,
    ]);
    expect(got?.size).toBe(2);
    // potree's own findHit (a per-pixel scan of the whole window that zeroes every alpha: ~2 ms per
    // window, ~20 ms under the CPU profiler) is never run; its hit is not used (Task 17)
    expect(findHit).not.toHaveBeenCalled();
    expect(got?.rgba).toBe(pixels); // potree allocates the read-back per pick: no copy is needed
    expect(got?.rgba[3]).toBe(2);
    expect(got?.nodes.map((n) => n.node)).toEqual(chosen);
    expect(statics.nodesOnRay(pco, null)).toEqual(["the ray's nodes"]); // restored
  });

  it("answers null when potree throws (more than 255 nodes) and still restores the statics", () => {
    const pco = {
      pick: vi.fn(() => {
        throw new Error("More than 255 nodes for pick are not supported.");
      }),
    };
    const findHit = statics.findHit;
    const got = pickWindowPixels(pco as never, {} as never, new THREE.PerspectiveCamera(), new THREE.Ray(), {
      windowSize: 2,
      pixel: new THREE.Vector3(),
      nodes: [],
    });
    expect(got).toBeNull();
    expect(statics.findHit).toBe(findHit);
  });
});
