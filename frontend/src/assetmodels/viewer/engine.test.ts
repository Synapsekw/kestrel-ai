import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  AUTO_ROTATE_SPEED,
  GHOST_OPACITY,
  GROUND_RENDER_ORDER,
  MODEL_FOV,
  PATCH_ALPHA_TEST,
  PATCH_POLYGON_OFFSET,
  PATCH_RENDER_ORDER,
  ghostMaterial,
  partsFromScene,
  presetCamera,
  renderLoop,
  restoreView,
  saveView,
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

describe("render loop", () => {
  it("keeps one frame pending while a frame's own update asks for another (auto-rotate)", () => {
    const queue: FrameRequestCallback[] = [];
    let loop: ReturnType<typeof renderLoop> | null = null;
    let draws = 0;
    loop = renderLoop({
      // controls.update() under auto-rotate fires "change", which requests a render from inside the frame
      draw: () => {
        draws += 1;
        loop!.request();
      },
      keepAlive: () => true,
      raf: (cb) => queue.push(cb),
      caf: () => {},
      now: () => 0,
    });
    loop.request();
    expect(queue).toHaveLength(1);
    for (let i = 0; i < 5; i++) {
      const cb = queue.shift()!;
      cb(0);
      expect(queue).toHaveLength(1);
    }
    expect(draws).toBe(5);
    loop.stop();
  });

  it("idles a second after the last request when nothing keeps it alive", () => {
    const queue: FrameRequestCallback[] = [];
    let t = 0;
    const loop = renderLoop({
      draw: () => {},
      keepAlive: () => false,
      raf: (cb) => queue.push(cb),
      now: () => t,
    });
    loop.request();
    queue.shift()!(0);
    expect(queue).toHaveLength(1);
    t = 1001;
    queue.shift()!(0);
    expect(queue).toHaveLength(0);
  });
});

describe("ghost materials", () => {
  it("ghosts a material and restores its authored alpha", () => {
    const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4, depthWrite: false });
    ghostMaterial(glass, true);
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBe(GHOST_OPACITY);
    expect(glass.depthWrite).toBe(false);
    ghostMaterial(glass, false);
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBe(0.4);
    expect(glass.depthWrite).toBe(false);
  });

  it("leaves an untouched material as authored when ghost is off", () => {
    const solid = new THREE.MeshStandardMaterial();
    ghostMaterial(solid, false);
    expect(solid.transparent).toBe(false);
    expect(solid.opacity).toBe(1);
    expect(solid.depthWrite).toBe(true);
    const blend = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 });
    ghostMaterial(blend, false);
    expect(blend.transparent).toBe(true);
    expect(blend.opacity).toBe(0.5);
  });
});

describe("pose view and preset views", () => {
  it("viewFromPose(null) restores position, target, up, fov, near and far", () => {
    const cam = new THREE.PerspectiveCamera(MODEL_FOV, 1, 0.4, 400);
    cam.position.set(10, 8, 10);
    const target = new THREE.Vector3(0, 3, 0);
    const saved = saveView(cam, target);
    // what a photo pose does to the camera
    cam.position.set(1, 2, 3);
    cam.up.set(0.2, 0.98, 0);
    cam.fov = 52;
    cam.near = 0.05;
    cam.far = 5000;
    target.set(0, 0, 0);
    restoreView(cam, target, saved);
    expect(cam.position.toArray()).toEqual([10, 8, 10]);
    expect(target.toArray()).toEqual([0, 3, 0]);
    expect(cam.up.toArray()).toEqual([0, 1, 0]);
    expect([cam.fov, cam.near, cam.far]).toEqual([MODEL_FOV, 0.4, 400]);
  });

  it("a preset view drops the pose's roll and lens", () => {
    const cam = new THREE.PerspectiveCamera(52, 1, 0.05, 1000);
    cam.up.set(0.2, 0.98, 0);
    presetCamera(cam);
    expect(cam.up.toArray()).toEqual([0, 1, 0]);
    expect(cam.fov).toBe(38);
  });
});
