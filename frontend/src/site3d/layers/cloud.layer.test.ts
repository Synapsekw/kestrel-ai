import * as THREE from "three";
import type { PointCloudOctree } from "potree-core";
import { describe, expect, it, vi } from "vitest";
import { fakeSiteEngine } from "@/test/fakeSiteEngine";
import { FRAME, cloudRow } from "@/test/siteSceneFixtures";
import type { CloudHost } from "./cloudHost";
import { CANT_PLACE, NO_FRAME, createCloudLayer, yUpElevation } from "./cloud.layer";
import { siteToSceneMatrix } from "./sceneMatrix";

const SHADER = "float w = (world.z - heightMin) / (heightMax - heightMin);";

function fakePco() {
  const o = new THREE.Object3D();
  const material = {
    newFormat: true,
    vertexShader: SHADER,
    needsUpdate: false,
    pointColorType: 0,
    elevationRange: [0, 1] as [number, number],
    inputColorEncoding: 0,
    outputColorEncoding: 0,
    pointSizeType: 0,
    // potree-core regenerates the source from its template on every shader-affecting change
    updateShaderSource() {
      this.vertexShader = SHADER;
    },
  };
  Object.assign(o, {
    material,
    pcoGeometry: {},
    dispose: vi.fn(),
    getBoundingBoxWorld: () => new THREE.Box3(new THREE.Vector3(0, -5, 0), new THREE.Vector3(10, 40, 10)),
  });
  return o as unknown as PointCloudOctree & { material: typeof material; dispose: ReturnType<typeof vi.fn> };
}

function fakeHost(load: CloudHost["load"] = vi.fn(async () => fakePco())) {
  return {
    load: vi.fn(load),
    add: vi.fn(),
    remove: vi.fn(),
    budget: () => 3_000_000,
    setBudget: vi.fn(),
    update: vi.fn(() => false),
  };
}
const BASE = "http://127.0.0.1:4010";

describe("cloud layer", () => {
  it("other crs: never loads or projects the cloud, and says it can't place it", async () => {
    const host = fakeHost();
    const { engine, scene } = fakeSiteEngine();
    const layer = createCloudLayer({
      cloud: cloudRow({ same_crs: false }),
      frame: FRAME,
      baseUrl: BASE,
      token: "t",
      host,
    });
    await layer.attach(engine);
    expect(host.load).not.toHaveBeenCalled();
    expect(layer.status.get()).toEqual({ kind: "unavailable", reason: CANT_PLACE });
    expect(CANT_PLACE).toMatch(/^Can't place this cloud/);
    expect(scene.getObjectByName("cloud:c1")).toBeUndefined();
    expect(layer.box()).toBeNull();
  });

  it("without the site's plant grid it can't place the cloud either", async () => {
    const host = fakeHost();
    const { engine } = fakeSiteEngine();
    const layer = createCloudLayer({ cloud: cloudRow(), frame: null, baseUrl: BASE, token: "t", host });
    await layer.attach(engine);
    expect(host.load).not.toHaveBeenCalled();
    expect(layer.status.get()).toEqual({ kind: "unavailable", reason: NO_FRAME });
  });

  it("loads a same-CRS cloud under the site→scene matrix, with its z offset", async () => {
    const host = fakeHost();
    const { engine, scene } = fakeSiteEngine();
    const layer = createCloudLayer({ cloud: cloudRow(), frame: FRAME, baseUrl: BASE, token: "t", host });
    await layer.attach(engine);
    expect(host.load).toHaveBeenCalledWith(
      `${BASE}/api/v1/projects/p/pointclouds/c1/octree/metadata.json`,
      expect.anything(),
    );
    const group = scene.getObjectByName("cloud:c1")!;
    expect(group.matrix.equals(siteToSceneMatrix(FRAME, 120.45))).toBe(true);
    expect(group.children).toHaveLength(1);
    expect(host.add).toHaveBeenCalledWith(group.children[0]);
    expect(layer.status.get()).toEqual({ kind: "ready" });
  });

  it("keeps height colouring on scene Y after every shader regeneration", async () => {
    const pco = fakePco();
    const host = fakeHost(async () => pco);
    const { engine } = fakeSiteEngine();
    const layer = createCloudLayer({ cloud: cloudRow(), frame: FRAME, baseUrl: BASE, token: "t", host });
    await layer.attach(engine);
    expect(pco.material.vertexShader).toContain("world.y - heightMin");
    pco.material.updateShaderSource();
    expect(pco.material.vertexShader).toContain("world.y - heightMin");
    layer.setColour("elevation");
    expect(pco.material.pointColorType).toBe(3);
    expect(pco.material.elevationRange).toEqual([-5, 40]);
    expect(pco.material.newFormat).toBe(false); // a v2 octree reads rgba only in RGB mode
    layer.setColour("rgb");
    expect(pco.material.newFormat).toBe(true);
  });

  it("a failed load is an error status, never an exception", async () => {
    const host = fakeHost(async () => {
      throw new Error("HTTP 404");
    });
    const { engine } = fakeSiteEngine();
    const layer = createCloudLayer({ cloud: cloudRow(), frame: FRAME, baseUrl: BASE, token: "t", host });
    await layer.attach(engine);
    expect(layer.status.get()).toEqual({ kind: "error", message: "The cloud could not load: HTTP 404" });
  });

  it("a malformed octree URL is an error status, never an exception", async () => {
    const host = fakeHost();
    const { engine } = fakeSiteEngine();
    const layer = createCloudLayer({
      cloud: cloudRow({ octree_url: "/x/not-an-octree" }),
      frame: FRAME,
      baseUrl: BASE,
      token: "t",
      host,
    });
    await layer.attach(engine);
    expect(host.load).not.toHaveBeenCalled();
    expect(layer.status.get()).toEqual({
      kind: "error",
      message: `The cloud could not load: not an octree metadata URL: ${BASE}/x/not-an-octree`,
    });
  });

  it("hides with the toggle and asks for frames only while nodes load", async () => {
    const host = fakeHost();
    host.update.mockReturnValueOnce(true);
    const { engine, scene, camera, requestRender } = fakeSiteEngine();
    const layer = createCloudLayer({ cloud: cloudRow(), frame: FRAME, baseUrl: BASE, token: "t", host });
    await layer.attach(engine);
    requestRender.mockClear();
    layer.update?.(0.016, camera);
    expect(requestRender).toHaveBeenCalledTimes(1);
    layer.update?.(0.016, camera);
    expect(requestRender).toHaveBeenCalledTimes(1);
    layer.setVisible(false);
    expect(scene.getObjectByName("cloud:c1")!.visible).toBe(false);
  });

  it("detach releases the cloud and leaves the scene", async () => {
    const pco = fakePco();
    const host = fakeHost(async () => pco);
    const { engine, scene } = fakeSiteEngine();
    const layer = createCloudLayer({ cloud: cloudRow(), frame: FRAME, baseUrl: BASE, token: "t", host });
    await layer.attach(engine);
    layer.detach();
    expect(host.remove).toHaveBeenCalledWith(pco);
    expect(pco.dispose).toHaveBeenCalled();
    expect(scene.getObjectByName("cloud:c1")).toBeUndefined();
  });

  it("yUpElevation rewrites every height read from world z to world y", () => {
    expect(yUpElevation(SHADER + "\n" + SHADER)).not.toContain("world.z");
  });
  it("attach after detach loads again (StrictMode)", async () => {
    const first = fakePco();
    const second = fakePco();
    const host = fakeHost(vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second));
    const { engine, scene } = fakeSiteEngine();
    const layer = createCloudLayer({ cloud: cloudRow(), frame: FRAME, baseUrl: BASE, token: "t", host });
    await layer.attach(engine);
    layer.detach();
    await layer.attach(engine);
    expect(host.load).toHaveBeenCalledTimes(2);
    expect(second.dispose).not.toHaveBeenCalled();
    expect(host.add).toHaveBeenLastCalledWith(second);
    expect(scene.getObjectByName("cloud:c1")!.children).toEqual([second]);
    expect(layer.status.get()).toEqual({ kind: "ready" });
    expect(layer.box()).not.toBeNull();
  });

  it("a stale load that resolves after a newer attach is disposed, never added", async () => {
    const stale = fakePco();
    const fresh = fakePco();
    let resolveStale!: (p: PointCloudOctree) => void;
    const load = vi
      .fn()
      .mockReturnValueOnce(new Promise<PointCloudOctree>((r) => (resolveStale = r)))
      .mockResolvedValueOnce(fresh);
    const host = fakeHost(load);
    const { engine, scene } = fakeSiteEngine();
    const layer = createCloudLayer({ cloud: cloudRow(), frame: FRAME, baseUrl: BASE, token: "t", host });
    const firstAttach = layer.attach(engine);
    layer.detach();
    await layer.attach(engine);
    resolveStale(stale);
    await firstAttach;
    expect(stale.dispose).toHaveBeenCalled();
    expect(host.add).not.toHaveBeenCalledWith(stale);
    expect(scene.getObjectByName("cloud:c1")!.children).toEqual([fresh]);
    expect(layer.status.get()).toEqual({ kind: "ready" });
  });

  it("a load that fails after detach leaves the status alone", async () => {
    let rejectLoad!: (e: Error) => void;
    const host = fakeHost(() => new Promise<PointCloudOctree>((_, rej) => (rejectLoad = rej)));
    const { engine } = fakeSiteEngine();
    const layer = createCloudLayer({ cloud: cloudRow(), frame: FRAME, baseUrl: BASE, token: "t", host });
    const pending = layer.attach(engine);
    await vi.waitFor(() => expect(host.load).toHaveBeenCalled());
    layer.detach();
    rejectLoad(new Error("HTTP 500"));
    await pending;
    expect(layer.status.get()).toEqual({ kind: "loading" });
  });
});
