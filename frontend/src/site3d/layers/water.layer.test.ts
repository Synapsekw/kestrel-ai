import * as THREE from "three";
import { Water } from "three/examples/jsm/objects/Water.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeSiteEngine } from "@/test/fakeSiteEngine";
const shader = vi.hoisted(() => ({ broken: false }));
vi.mock("three/examples/jsm/objects/Water.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("three/examples/jsm/objects/Water.js")>();
  /** three's Water, with its shader text optionally changed, as a future three release might. */
  class TestWater extends mod.Water {
    constructor(...args: ConstructorParameters<typeof mod.Water>) {
      super(...args);
      if (shader.broken) {
        const m = this.material as THREE.ShaderMaterial;
        m.fragmentShader = m.fragmentShader.replace("uniform vec3 waterColor;", "uniform vec3 seaColour;");
      }
    }
  }
  return { ...mod, Water: TestWater };
});

import {
  WATER_SHADER_CHANGED,
  NO_MODEL,
  NO_SEA,
  collectTriangles,
  createWaterLayer,
  flatGeometry,
} from "./water.layer";

/** A GLB root like A1's: environment nodes carry `extras.env` (GLTFLoader puts extras in userData). */
function plantRoot({ sea = true, land = true } = {}) {
  const root = new THREE.Group();
  if (sea) {
    const s = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial(),
    );
    s.name = "environment/sea-1";
    s.userData.env = "sea";
    s.position.set(0, -6, 250); // z 50..450: runs 50 m under the land's edge, like Cowork's Sea
    root.add(s);
  }
  if (land) {
    const g = new THREE.Group();
    g.userData.env = "land"; // the extras sit on the parent node, the mesh is its child
    g.add(new THREE.Mesh(new THREE.BoxGeometry(400, 6, 200), new THREE.MeshBasicMaterial()));
    g.position.set(0, -3, 0);
    root.add(g);
  }
  return root;
}
afterEach(() => {
  shader.broken = false;
});
const opts = { normals: () => new THREE.Texture(), reduced: () => false };

describe("water layer", () => {
  it("no model yet: unavailable with a reason, nothing drawn", () => {
    const { engine, scene } = fakeSiteEngine();
    const layer = createWaterLayer(opts);
    layer.attach(engine);
    expect(layer.status.get()).toEqual({ kind: "unavailable", reason: NO_MODEL });
    expect(scene.getObjectByName("site-water")).toBeUndefined();
  });

  it("no sea: unavailable, never throws", () => {
    const { engine, scene } = fakeSiteEngine();
    const layer = createWaterLayer(opts);
    layer.attach(engine);
    layer.setModel(plantRoot({ sea: false }));
    expect(layer.status.get()).toEqual({ kind: "unavailable", reason: NO_SEA });
    expect(scene.getObjectByName("site-water")).toBeUndefined();
  });

  it("sea and land: three Water on the sea's top, foam from the shoreline, the sea node hidden", () => {
    const { engine, scene } = fakeSiteEngine();
    const root = plantRoot();
    const layer = createWaterLayer(opts);
    layer.attach(engine);
    layer.setModel(root);
    const water = scene.getObjectByName("site-water") as Water;
    expect(water).toBeInstanceOf(Water);
    expect(water.position.y).toBeCloseTo(-5.98, 6);
    const mat = water.material as THREE.ShaderMaterial;
    expect(mat.fragmentShader).toContain("uniform sampler2D shoreSampler;");
    expect(mat.fragmentShader).toContain("mix( outgoingLight, foamColor");
    expect(mat.uniforms.shoreSampler.value).toBeInstanceOf(THREE.DataTexture);
    expect(root.getObjectByName("environment/sea-1")!.visible).toBe(false);
    expect(layer.status.get()).toEqual({ kind: "ready" });
  });

  it("sea without land: water without foam", () => {
    const { engine, scene } = fakeSiteEngine();
    const layer = createWaterLayer(opts);
    layer.attach(engine);
    layer.setModel(plantRoot({ land: false }));
    const mat = (scene.getObjectByName("site-water") as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(mat.fragmentShader).not.toContain("shoreSampler");
  });

  it("reduced effects: flat water, no mirror pass", () => {
    const { engine, scene } = fakeSiteEngine();
    const layer = createWaterLayer({ ...opts, reduced: () => true });
    layer.attach(engine);
    layer.setModel(plantRoot());
    const mesh = scene.getObjectByName("site-water") as THREE.Mesh;
    expect(mesh).not.toBeInstanceOf(Water);
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(layer.status.get()).toEqual({ kind: "ready", note: "Flat water (reduced effects)" });
  });

  it("off: the water hides and the model's own sea shows again; detach restores it too", () => {
    const { engine, scene } = fakeSiteEngine();
    const root = plantRoot();
    const layer = createWaterLayer(opts);
    layer.attach(engine);
    layer.setModel(root);
    layer.setVisible(false);
    expect(scene.getObjectByName("site-water")!.visible).toBe(false);
    expect(root.getObjectByName("environment/sea-1")!.visible).toBe(true);
    layer.setVisible(true);
    layer.detach();
    expect(scene.getObjectByName("site-water")).toBeUndefined();
    expect(root.getObjectByName("environment/sea-1")!.visible).toBe(true);
  });

  it("attach after detach shows again (StrictMode re-attaches the same layer)", () => {
    const { engine, scene } = fakeSiteEngine();
    const root = plantRoot();
    const layer = createWaterLayer(opts);
    layer.attach(engine);
    layer.setModel(root);
    layer.detach();
    expect(root.getObjectByName("environment/sea-1")!.visible).toBe(true);
    layer.attach(engine);
    const water = scene.getObjectByName("site-water");
    expect(water).toBeInstanceOf(Water);
    expect(water!.visible).toBe(true);
    expect(scene.children.filter((c) => c.name === "site-water")).toHaveLength(1);
    expect(root.getObjectByName("environment/sea-1")!.visible).toBe(false);
    expect(layer.status.get()).toEqual({ kind: "ready" });
    layer.detach();
    expect(root.getObjectByName("environment/sea-1")!.visible).toBe(true);
  });

  it("finds the sea by its material name alone (a GLB without extras)", () => {
    const { engine, scene } = fakeSiteEngine();
    const root = plantRoot({ sea: false });
    const s = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ name: "Sea" }),
    );
    s.name = "sea-feature-7";
    s.position.set(0, -6, 250);
    root.add(s);
    const layer = createWaterLayer(opts);
    layer.attach(engine);
    layer.setModel(root);
    expect(scene.getObjectByName("site-water")).toBeInstanceOf(Water);
    expect(s.visible).toBe(false);
    expect(layer.status.get()).toEqual({ kind: "ready" });
  });

  it("a changed Water shader: no throw, nothing leaked, the sea shown, an error status", () => {
    shader.broken = true;
    const { engine, scene } = fakeSiteEngine();
    const root = plantRoot();
    const layer = createWaterLayer(opts);
    const disposeTarget = vi.spyOn(THREE.WebGLRenderTarget.prototype, "dispose");
    layer.attach(engine);
    expect(() => {
      layer.setModel(root);
    }).not.toThrow();
    expect(scene.getObjectByName("site-water")).toBeUndefined();
    expect(root.getObjectByName("environment/sea-1")!.visible).toBe(true);
    expect(disposeTarget).toHaveBeenCalledTimes(1); // the mirror's 512² target
    expect(layer.status.get()).toEqual({ kind: "error", message: WATER_SHADER_CHANGED });
    disposeTarget.mockRestore();
  });

  it("collects a Cowork-style 'Sea' node by name and the land by an ancestor's extras", () => {
    const root = plantRoot({ sea: false });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2));
    s.name = "Sea";
    root.add(s);
    expect(collectTriangles(root, (n) => n.name === "Sea" || n.userData.env === "sea").tris.length).toBe(12);
    expect(collectTriangles(root, (n) => n.userData.env === "land").meshes).toHaveLength(1);
  });

  it("flatGeometry faces up once laid flat, whatever the source winding", () => {
    const g = flatGeometry([0, 0, 0, 10, 10, 0]); // clockwise seen from above
    const m = new THREE.Mesh(g);
    m.rotation.x = -Math.PI / 2;
    m.updateMatrixWorld();
    g.computeVertexNormals();
    const n = new THREE.Vector3()
      .fromBufferAttribute(g.getAttribute("normal"), 0)
      .transformDirection(m.matrixWorld);
    expect(n.y).toBeCloseTo(1, 6);
  });
});
