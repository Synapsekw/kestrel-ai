import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { describe, expect, it, vi } from "vitest";
import type { SiteEngine } from "../engine/SiteEngine";
import {
  collectItems,
  colourKey,
  createModelLayer,
  glbLoader,
  isFlagged,
  itemIdOf,
  itemNodeOf,
  type ModelLayer,
} from "./model.layer";
import type { PickHit, Pickable } from "./types";

function item(id: string, type: string, extra: Record<string, unknown>, x: number): THREE.Group {
  const node = new THREE.Group();
  node.userData = { id, node: id, type, area: "20", ...extra };
  const part = new THREE.Group();
  part.userData = { id: `${id}/shell`, type: "part_shell" }; // a part with extras: the item is the outermost
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
  mesh.position.set(x, 1, 0);
  part.add(mesh);
  node.add(part);
  return node;
}

function plant(): THREE.Group {
  const root = new THREE.Group();
  const area = new THREE.Group();
  area.userData = { group: "area", area: "20" };
  area.add(
    item("20-t-0001", "tank_lng", { height_source: "drawing", flags: "", name: "LNG tank" }, 0),
    item("rack.1", "pipe_rack", { height_source: "indicative", flags: "height_mismatch" }, 10),
  );
  const other = item("b-1", "building", { area: "30", height_source: "cloud", flags: [] }, 30);
  root.add(area, other);
  return root;
}

function engine() {
  let listener: ((h: PickHit | null) => void) | null = null;
  let pickable: Pickable | null = null;
  const e = {
    scene: new THREE.Scene(),
    requestRender: vi.fn(),
    addPickable: vi.fn((p: Pickable) => (pickable = p)),
    removePickable: vi.fn(),
    setContentBox: vi.fn(),
    setPresetBox: vi.fn(),
    clearPresets: vi.fn(),
    onSelect: vi.fn((cb: (h: PickHit | null) => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    }),
    emit: (h: PickHit | null) => listener?.(h),
    select: vi.fn((h: PickHit | null) => listener?.(h)),
    pickable: () => pickable!,
  };
  return e as unknown as SiteEngine & typeof e;
}

async function loaded(scene = plant()) {
  const e = engine();
  const onLoad = vi.fn();
  const layer = createModelLayer({ url: "x.glb", onLoad, loader: async () => scene });
  await layer.attach(e);
  return { e, layer, onLoad, scene };
}

const meshes = (l: ModelLayer) => {
  const out: THREE.Mesh[] = [];
  l.root.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh);
  });
  return out;
};

describe("model layer helpers", () => {
  it("ids come from extras, so dots survive (Review Focus 5)", () => {
    const items = collectItems(plant());
    expect(items.map((i) => i.id)).toEqual(["20-t-0001", "rack.1", "b-1"]);
    const n = new THREE.Object3D();
    n.userData = { type: "x", node: "only.node" };
    expect(itemIdOf(n)).toBe("only.node");
    n.userData = { node: "no-type" };
    expect(itemIdOf(n)).toBeNull();
  });

  it("A1's GLB: the item id is the node name from `node` (no `id`), children resolve to the item (R8)", () => {
    // assemble.py: item node named by its id with the CSV-cased register row as extras; children
    // `<id>/<name>` carry builder extras only; area groups and env nodes carry no `type`.
    const root = new THREE.Group();
    const area = new THREE.Group();
    area.name = "area:30";
    const item = new THREE.Group();
    item.name = "30-P-0001";
    item.userData = {
      node: "30-P-0001",
      tag: "30-P-0001",
      type: "other",
      area: "30",
      plant_E: 260,
      plant_N: 180,
      base_EL: 100,
      top_EL: 103,
      height_source: "drawing",
      flags: [],
      confidence: "high",
    };
    const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    child.name = "30-P-0001/body";
    child.userData = { shape: "box", params: { w: 6 } };
    item.add(child);
    const sea = new THREE.Group();
    sea.name = "Sea";
    sea.userData = { env: "sea", node: "sea" };
    area.add(item);
    root.add(area, sea);
    const items = collectItems(root);
    expect(items.map((i) => i.id)).toEqual(["30-P-0001"]);
    expect(items[0].node).toBe(item);
    expect(itemIdOf(child)).toBeNull();
    expect(itemNodeOf(child, root)).toBe(item);
  });

  it("colour keys per mode", () => {
    const x = { type: "pump", area: "20", height_source: "cloud", flags: "plan_offset" };
    expect(colourKey("material", x)).toBeNull();
    expect(colourKey("type", x)).toBe("pump");
    expect(colourKey("area", {})).toBe("none");
    expect(colourKey("height_source", { h_src: "drawing" })).toBe("drawing");
    expect(colourKey("flag", x)).toBe("flagged");
    expect(isFlagged({ flags: "[]" })).toBe(false);
    expect(isFlagged({ flags: ["builder_fallback"] })).toBe(true);
  });

  it("registers the meshopt decoder for imported GLBs (spec §15)", () => {
    expect((glbLoader() as unknown as { meshoptDecoder: unknown }).meshoptDecoder).toBe(MeshoptDecoder);
  });

  it("parses the e2e fixture GLB into its two items", async () => {
    const buf = readFileSync(resolve(__dirname, "../../../e2e/fixtures/site-plant.glb"));
    const gltf = await glbLoader().parseAsync(new Uint8Array(buf).buffer, "");
    const items = collectItems(gltf.scene);
    expect(items.map((i) => i.id)).toEqual(["20-t-0001", "rack.1"]);
    expect(items[0].extras.name).toBe("LNG tank");
  });
});

describe("ModelLayer", () => {
  it("loads: counts items, frames the content and makes one preset per area", async () => {
    const { e, onLoad } = await loaded();
    expect(onLoad).toHaveBeenCalledWith(
      { items: 3, areas: ["20", "30"], types: ["building", "pipe_rack", "tank_lng"] },
      "x.glb",
    );
    expect(e.setContentBox).toHaveBeenCalledWith("model", expect.any(THREE.Box3));
    expect(e.setPresetBox).toHaveBeenCalledWith("model", "area:20", expect.any(THREE.Box3));
    expect(e.setPresetBox).toHaveBeenCalledWith("model", "area:30", expect.any(THREE.Box3));
  });

  it("resolves a pick on a part's mesh to its item", async () => {
    const { e, layer } = await loaded();
    const mesh = meshes(layer)[1];
    expect(e.pickable().resolve(mesh)).toEqual({
      itemId: "rack.1",
      extras: expect.objectContaining({ type: "pipe_rack", flags: "height_mismatch" }),
    });
    expect(e.pickable().resolve(layer.root)).toBeNull();
  });

  it("colour by type shares a material per type; back to material restores the originals", async () => {
    const { layer } = await loaded();
    const before = meshes(layer).map((m) => m.material);
    layer.setColourBy("type");
    const after = meshes(layer).map((m) => m.material);
    expect(after[0]).not.toBe(before[0]);
    expect(new Set(after).size).toBe(3);
    layer.setColourBy("flag");
    const flagged = meshes(layer).map((m) => m.material);
    expect(flagged[0]).toBe(flagged[2]); // clean, clean
    expect(flagged[1]).not.toBe(flagged[0]); // flagged
    layer.setColourBy("material");
    expect(meshes(layer).map((m) => m.material)).toEqual(before);
  });

  it("see-through, wireframe and the cut apply to every material", async () => {
    const { e, layer } = await loaded();
    layer.setOpacity(0.4);
    layer.setWireframe(true);
    layer.setCut(1.5);
    for (const m of meshes(layer)) {
      const mat = m.material as THREE.MeshStandardMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.opacity).toBeCloseTo(0.4, 6);
      expect(mat.depthWrite).toBe(false);
      expect(mat.wireframe).toBe(true);
      expect(mat.clippingPlanes?.[0].constant).toBe(1.5);
    }
    expect(e.pickable().accepts!(new THREE.Vector3(0, 2, 0))).toBe(false);
    expect(e.pickable().accepts!(new THREE.Vector3(0, 1, 0))).toBe(true);
    layer.setCut(null);
    expect((meshes(layer)[0].material as THREE.Material).clippingPlanes).toBeNull();
  });

  it("outlines the selected item and clears on null", async () => {
    const { e, layer } = await loaded();
    e.emit({ layerId: "model", itemId: "rack.1", point: [0, 0, 0], extras: {} });
    expect(layer.helpers.children.length).toBeGreaterThan(0);
    e.emit({ layerId: "other", itemId: "rack.1", point: [0, 0, 0], extras: {} });
    expect(layer.helpers.children).toHaveLength(0);
  });

  it("itemBox and itemIds", async () => {
    const { layer } = await loaded();
    expect(layer.itemIds()).toEqual(["20-t-0001", "rack.1", "b-1"]);
    expect(layer.itemBox("rack.1")?.getCenter(new THREE.Vector3()).x).toBeCloseTo(10, 6);
    expect(layer.itemBox("nope")).toBeNull();
  });

  it("a failed load calls onError; a detach before the load ends drops it", async () => {
    const onError = vi.fn();
    const failing = createModelLayer({
      url: "x",
      onError,
      loader: async () => Promise.reject(new Error("409")),
    });
    await failing.attach(engine());
    expect(onError).toHaveBeenCalled();

    let finish: (o: THREE.Object3D) => void = () => {};
    const onLoad = vi.fn();
    const slow = createModelLayer({ url: "x", onLoad, loader: () => new Promise((r) => (finish = r)) });
    const e = engine();
    const pending = slow.attach(e);
    slow.detach();
    finish(plant());
    await pending;
    expect(onLoad).not.toHaveBeenCalled();
    expect(slow.root.children).toHaveLength(0);
    expect(e.removePickable).toHaveBeenCalledWith("model");
  });

  it("visibility hides the model and its outline", async () => {
    const { layer } = await loaded();
    layer.setVisible(false);
    expect(layer.root.visible).toBe(false);
    expect(layer.helpers.visible).toBe(false);
  });
});

describe("ModelLayer lifecycle (fix round 1)", () => {
  it("detach disposes geometry, material and the material's textures", async () => {
    const scene = plant();
    const mesh = meshes({ root: scene } as unknown as ModelLayer)[0];
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.map = new THREE.Texture();
    mat.normalMap = new THREE.Texture();
    const spies = [
      vi.spyOn(mesh.geometry, "dispose"),
      vi.spyOn(mat, "dispose"),
      vi.spyOn(mat.map, "dispose"),
      vi.spyOn(mat.normalMap, "dispose"),
    ];
    const { layer } = await loaded(scene);
    layer.setColourBy("type"); // the originals must still be the ones disposed
    layer.detach();
    for (const s of spies) expect(s).toHaveBeenCalled();
  });

  it("a load that ends after detach disposes the orphan's textures", async () => {
    let finish: (o: THREE.Object3D) => void = () => {};
    const slow = createModelLayer({ url: "x", loader: () => new Promise((r) => (finish = r)) });
    const pending = slow.attach(engine());
    slow.detach();
    const scene = plant();
    const mat = meshes({ root: scene } as unknown as ModelLayer)[0].material as THREE.MeshStandardMaterial;
    mat.map = new THREE.Texture();
    const spy = vi.spyOn(mat.map, "dispose");
    finish(scene);
    await pending;
    expect(spy).toHaveBeenCalled();
  });

  it("emitting null clears the outline", async () => {
    const { e, layer } = await loaded();
    e.emit({ layerId: "model", itemId: "rack.1", point: [0, 0, 0], extras: {} });
    expect(layer.helpers.children.length).toBeGreaterThan(0);
    e.emit(null);
    expect(layer.helpers.children).toHaveLength(0);
  });

  it("an item with an instanced mesh is outlined by its bounding box", async () => {
    const scene = plant();
    const node = scene.children[1]; // b-1
    node.add(new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(), 4));
    const { e, layer } = await loaded(scene);
    e.emit({ layerId: "model", itemId: "b-1", point: [0, 0, 0], extras: {} });
    expect(layer.helpers.children).toHaveLength(1);
    expect(layer.helpers.children[0]).toBeInstanceOf(THREE.Box3Helper);
  });

  it("the outline follows the cut", async () => {
    const { e, layer } = await loaded();
    e.emit({ layerId: "model", itemId: "rack.1", point: [0, 0, 0], extras: {} });
    layer.setCut(1.5);
    const lineMats = () =>
      layer.helpers.children.map((c) => (c as THREE.LineSegments).material as THREE.Material);
    expect(lineMats().length).toBeGreaterThan(0);
    for (const m of lineMats()) expect(m.clippingPlanes?.[0].constant).toBe(1.5);
    layer.setCut(null);
    for (const m of lineMats()) expect(m.clippingPlanes ?? null).toBeNull();
  });

  it("a second attach keeps one select listener", async () => {
    const e = engine();
    const live = new Set<unknown>();
    e.onSelect.mockImplementation((cb: (h: PickHit | null) => void) => {
      live.add(cb);
      return () => {
        live.delete(cb);
      };
    });
    const layer = createModelLayer({ url: "x", loader: async () => plant() });
    await layer.attach(e);
    await layer.attach(e);
    expect(e.onSelect).toHaveBeenCalledTimes(2);
    expect(live.size).toBe(1);
    expect(layer.itemIds()).toEqual(["20-t-0001", "rack.1", "b-1"]); // adopted without an onLoad
    layer.detach();
    expect(live.size).toBe(0);
  });

  it("an onLoad exception is not reported as a load error", async () => {
    const onError = vi.fn();
    const layer = createModelLayer({
      url: "x",
      loader: async () => plant(),
      onLoad: () => {
        throw new Error("consumer");
      },
      onError,
    });
    await expect(layer.attach(engine())).rejects.toThrow("consumer");
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("ModelLayer swap and select (S3 Task 1b)", () => {
  const ids = (l: ModelLayer) => l.itemIds();
  function single(id: string): THREE.Group {
    const root = new THREE.Group();
    root.add(item(id, "pump", {}, 5));
    return root;
  }

  it("load swaps the content, keeps the camera and reports the new url", async () => {
    const e = engine();
    const onLoad = vi.fn();
    const scenes: Record<string, THREE.Object3D> = { "v1.glb": plant(), "v2.glb": single("p-9") };
    const layer = createModelLayer({ url: "v1.glb", onLoad, loader: async (u) => scenes[u] });
    await layer.attach(e);
    expect(layer.url).toBe("v1.glb");
    await layer.load("v2.glb");
    expect(ids(layer)).toEqual(["p-9"]);
    expect(layer.root.children).toHaveLength(1);
    expect(layer.url).toBe("v2.glb");
    expect(onLoad).toHaveBeenLastCalledWith({ items: 1, areas: ["20"], types: ["pump"] }, "v2.glb");
    expect(e.addPickable).toHaveBeenCalledTimes(1); // the same layer, not a new attach
  });

  it("a failed load keeps the old model, reports the error and rejects", async () => {
    const e = engine();
    const onError = vi.fn();
    const layer = createModelLayer({
      url: "v1.glb",
      onError,
      loader: async (u) => (u === "v1.glb" ? plant() : Promise.reject(new Error("bad glb"))),
    });
    await layer.attach(e);
    await expect(layer.load("v2.glb")).rejects.toThrow("bad glb");
    expect(ids(layer)).toEqual(["20-t-0001", "rack.1", "b-1"]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "v2.glb");
  });

  it("a load superseded by a newer one is dropped", async () => {
    const e = engine();
    const finish: Record<string, (o: THREE.Object3D) => void> = {};
    const layer = createModelLayer({
      url: "v1.glb",
      loader: (u) => (u === "v1.glb" ? Promise.resolve(plant()) : new Promise((r) => (finish[u] = r))),
    });
    await layer.attach(e);
    const a = layer.load("v2.glb");
    const b = layer.load("v3.glb");
    finish["v3.glb"](single("p-3"));
    await b;
    finish["v2.glb"](single("p-2"));
    await a;
    expect(ids(layer)).toEqual(["p-3"]);
  });

  it("the outline follows the selected item into the new version", async () => {
    const e = engine();
    const layer = createModelLayer({ url: "v1.glb", loader: async () => plant() });
    await layer.attach(e);
    e.emit({ layerId: "model", itemId: "rack.1", point: [0, 0, 0], extras: {} });
    await layer.load("v2.glb");
    expect(layer.helpers.children.length).toBeGreaterThan(0);
  });

  it("select(id) broadcasts a model hit at the item's centre with its extras; null clears", async () => {
    const { e, layer } = await loaded();
    layer.select("rack.1");
    expect(e.select).toHaveBeenCalledWith({
      layerId: "model",
      itemId: "rack.1",
      point: [expect.closeTo(10, 6), expect.closeTo(1, 6), expect.closeTo(0, 6)],
      extras: expect.objectContaining({ type: "pipe_rack" }),
    });
    expect(layer.helpers.children.length).toBeGreaterThan(0);
    layer.select(null);
    expect(e.select).toHaveBeenLastCalledWith(null);
    expect(layer.helpers.children).toHaveLength(0);
  });

  it("select of an id the model lacks clears the outline without a broadcast", async () => {
    const { e, layer } = await loaded();
    layer.select("rack.1");
    e.select.mockClear();
    layer.select("no-geometry");
    expect(e.select).not.toHaveBeenCalled();
    expect(layer.helpers.children).toHaveLength(0);
  });
});
