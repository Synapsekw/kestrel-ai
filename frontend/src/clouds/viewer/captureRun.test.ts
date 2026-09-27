import * as THREE from "three";
import type { CloudViewPose } from "@contract/client";
import { describe, expect, it, vi } from "vitest";
import { runCapture } from "./captureRun";
import type { EngineParts } from "./engineParts";

const pose: CloudViewPose = { position: [0, -30, 40], target: [0, 0, 0], up: [0, 0, 1], fov_deg: 50 };

/** A fake `EngineParts` whose `renderer.getClearColor` throws right after `setFrozen(true)` and the
 * render-target/texture allocation — standing in for the plan's named risk (spec §14 "context lost
 * during a capture"): a GPU call made during the capture's own setup, before the point-cloud load
 * or the draw. `recoverableFinally` controls whether the finally block's own screen-camera restore
 * (`potree.updatePointClouds`) also throws, so the same fake covers both review findings. */
function fakePartsThatThrowsDuringSetup(recoverableFinally: boolean) {
  const setFrozenCalls: boolean[] = [];
  const requestRender = vi.fn();
  const overlay = { visible: true } as unknown as THREE.Group;
  const overlayScene = { add: vi.fn(), remove: vi.fn() } as unknown as THREE.Scene;
  const renderer = {
    getContext: () => ({ isContextLost: () => false }),
    getClearColor: vi.fn(() => {
      throw new Error("the 3D view lost its graphics context during the capture");
    }),
    getClearAlpha: vi.fn(() => 1),
    setClearColor: vi.fn(),
    readRenderTargetPixels: vi.fn(),
  } as unknown as THREE.WebGLRenderer;
  const pco = { pcoGeometry: {} } as never;
  const potree = recoverableFinally ? ({ updatePointClouds: vi.fn() } as never) : ({} as never); // no updatePointClouds: the finally's own recovery call throws too
  const parts: EngineParts = {
    renderer,
    overlayScene,
    overlay,
    camera: new THREE.PerspectiveCamera(),
    potree,
    canvas: document.createElement("canvas"),
    bounds: null,
    pco: () => pco,
    edl: () => ({ on: false, rendersToTarget: false }),
    clearRgb: () => [21, 27, 25],
    accentRgb: () => [229, 175, 100],
    idle: () => true,
    frozen: () => false,
    setFrozen: (f: boolean) => setFrozenCalls.push(f),
    pickParams: () => ({}),
    pickGuard: (fn) => fn(),
    renderToTarget: vi.fn(),
    requestRender,
  };
  return { parts, setFrozenCalls, requestRender };
}

describe("runCapture: a throw during GPU-resource setup (review I1)", () => {
  it("still unfreezes the loop and clears the busy chip, and the promise rejects with the real error", async () => {
    const { parts, setFrozenCalls, requestRender } = fakePartsThatThrowsDuringSetup(true);
    const notify = vi.fn();
    await expect(runCapture(parts, pose, [], {}, notify)).rejects.toThrow(
      "the 3D view lost its graphics context during the capture",
    );
    // frozen, then unfrozen: never left true after the throw
    expect(setFrozenCalls).toEqual([true, false]);
    // notified busy, then notified not-busy: the chip never sticks
    expect(notify.mock.calls.map((c) => c[0])).toEqual([true, false]);
    expect(requestRender).toHaveBeenCalled();
  });

  it("a second failure while restoring the screen camera in finally does not mask the real error, and cleanup still runs", async () => {
    const { parts, setFrozenCalls, requestRender } = fakePartsThatThrowsDuringSetup(false);
    const notify = vi.fn();
    // the finally block's own `potree.updatePointClouds` call throws here too, but the promise must
    // still reject with the setup failure, not the cleanup failure
    await expect(runCapture(parts, pose, [], {}, notify)).rejects.toThrow(
      "the 3D view lost its graphics context during the capture",
    );
    expect(setFrozenCalls).toEqual([true, false]);
    expect(notify.mock.calls.map((c) => c[0])).toEqual([true, false]);
    expect(requestRender).toHaveBeenCalled();
  });
});

/** A fake whose cloud goes away (the engine disposed: `parts.pco()` answers null) while the capture
 * waits for the pose's nodes. */
function fakePartsDisposedMidWait() {
  let disposed = false;
  const setFrozenCalls: boolean[] = [];
  const pco = { pcoGeometry: { numNodesLoading: 1 } } as never;
  const updatePointClouds = vi.fn(() => {
    disposed = true; // the engine is rebuilt while this step's node loads are in flight
    return { nodeLoadPromises: [Promise.resolve()], exceededMaxLoadsToGPU: false };
  });
  const renderer = {
    getContext: () => ({ isContextLost: () => false }),
    getClearColor: vi.fn((c: THREE.Color) => c),
    getClearAlpha: vi.fn(() => 1),
    setClearColor: vi.fn(),
    readRenderTargetPixels: vi.fn(),
  } as unknown as THREE.WebGLRenderer;
  const renderToTarget = vi.fn();
  const parts: EngineParts = {
    renderer,
    overlayScene: { add: vi.fn(), remove: vi.fn() } as unknown as THREE.Scene,
    overlay: { visible: true } as unknown as THREE.Group,
    camera: new THREE.PerspectiveCamera(),
    potree: { updatePointClouds } as never,
    canvas: document.createElement("canvas"),
    bounds: null,
    pco: () => (disposed ? null : pco),
    edl: () => ({ on: false, rendersToTarget: false }),
    clearRgb: () => [21, 27, 25],
    accentRgb: () => [229, 175, 100],
    idle: () => true,
    frozen: () => false,
    setFrozen: (f: boolean) => setFrozenCalls.push(f),
    pickParams: () => ({}),
    pickGuard: (fn) => fn(),
    renderToTarget,
    requestRender: vi.fn(),
  };
  return { parts, setFrozenCalls, updatePointClouds, renderer, renderToTarget };
}

describe("runCapture: the engine disposed mid-capture (review T8 I1)", () => {
  it("rejects, stops updating the old octree, draws nothing and touches no GL state", async () => {
    const { parts, setFrozenCalls, updatePointClouds, renderer, renderToTarget } = fakePartsDisposedMidWait();
    const notify = vi.fn();
    await expect(runCapture(parts, pose, [], { timeoutMs: 5_000 }, notify)).rejects.toThrow(
      "the cloud changed during the capture",
    );
    expect(updatePointClouds).toHaveBeenCalledTimes(1); // no further LOD update on the disposed cloud
    expect(renderToTarget).not.toHaveBeenCalled();
    expect(renderer.setClearColor).not.toHaveBeenCalled(); // the next engine shares the WebGL context
    expect(renderer.readRenderTargetPixels).not.toHaveBeenCalled();
    expect(setFrozenCalls).toEqual([true, false]);
    expect(notify.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });
});
