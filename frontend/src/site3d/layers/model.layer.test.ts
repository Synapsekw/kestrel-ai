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
      return () => (listener = null);
    }),
    emit: (h: PickHit | null) => listener?.(h),
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
    expect(onLoad).toHaveBeenCalledWith({
      items: 3,
      areas: ["20", "30"],
      types: ["building", "pipe_rack", "tank_lng"],
    });
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
