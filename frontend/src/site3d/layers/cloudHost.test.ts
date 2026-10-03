import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { makeRequestManager } from "@/clouds/viewer/requestManager";
import { createCloudHost } from "./cloudHost";

function fakePotree() {
  return {
    pointBudget: 0,
    loadPointCloud: vi.fn(async () => new THREE.Object3D()),
    updatePointClouds: vi.fn(() => ({ nodeLoadPromises: [Promise.resolve()], exceededMaxLoadsToGPU: false })),
  };
}
const rm = makeRequestManager("t");
const camera = new THREE.PerspectiveCamera();
const renderer = {} as THREE.WebGLRenderer;

describe("cloud host", () => {
  it("makes one Potree lazily, with the budget, and setBudget reaches it", async () => {
    const p = fakePotree();
    const make = vi.fn(async () => p as never);
    const host = createCloudHost(make, 2_000_000);
    expect(make).not.toHaveBeenCalled();
    host.setBudget(5_000_000);
    await host.load("http://x/metadata.json", rm);
    await host.load("http://y/metadata.json", rm);
    expect(make).toHaveBeenCalledTimes(1);
    expect(p.pointBudget).toBe(5_000_000);
    host.setBudget(1_000_000);
    expect(p.pointBudget).toBe(1_000_000);
    expect(host.budget()).toBe(1_000_000);
  });

  it("updates the visible clouds once per frame and says while nodes load", async () => {
    const p = fakePotree();
    const host = createCloudHost(async () => p as never, 3_000_000);
    const a = await host.load("http://x/metadata.json", rm);
    host.add(a);
    expect(host.update(camera, renderer, 1)).toBe(true);
    expect(host.update(camera, renderer, 1)).toBe(true); // same frame: no second update
    expect(p.updatePointClouds).toHaveBeenCalledTimes(1);
    host.update(camera, renderer, 2);
    expect(p.updatePointClouds).toHaveBeenCalledTimes(2);
  });

  it("skips hidden clouds and removed ones", async () => {
    const p = fakePotree();
    const host = createCloudHost(async () => p as never, 3_000_000);
    const a = await host.load("http://x/metadata.json", rm);
    host.add(a);
    a.visible = false;
    expect(host.update(camera, renderer, 1)).toBe(false);
    a.visible = true;
    host.remove(a);
    expect(host.update(camera, renderer, 2)).toBe(false);
    expect(p.updatePointClouds).not.toHaveBeenCalled();
  });
});
