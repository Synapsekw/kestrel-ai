import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { disposeChildren } from "@/clouds/viewer/dispose";
import { tokenColor, tokenRgb } from "@/clouds/viewer/overlay";
import type { SiteEngine } from "../engine/SiteEngine";
import type { PickHit, SiteLayer } from "./types";

export type ColourBy = "material" | "type" | "area" | "height_source" | "flag";
export const MODEL_LAYER_ID = "model";
export const OUTLINE_MAX_TRIANGLES = 200_000;
const GOLDEN = 0.618033988749895;
type Extras = Record<string, unknown>;

export interface ModelItem {
  id: string;
  node: THREE.Object3D;
  extras: Extras;
}
export interface ModelLoadInfo {
  items: number;
  areas: string[];
  types: string[];
}
export interface ModelLayerOptions {
  url: string;
  label?: string;
  /** `url` is the GLB that loaded: the first one, or a later `load(url)`. */
  onLoad?(info: ModelLoadInfo, url: string): void;
  onError?(err: unknown, url: string): void;
  /** Tests pass a scene; the app loads the GLB. */
  loader?(url: string): Promise<THREE.Object3D>;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Ruling R8: an item node has a string `type` and an `id` (else `node`) in its extras. */
export function itemIdOf(o: THREE.Object3D): string | null {
  const ud = (o.userData ?? {}) as Extras;
  if (typeof ud.type !== "string") return null;
  return str(ud.id) ?? str(ud.node);
}

/** The outermost item node above `o` (a part may carry extras of its own), stopping at `stop`. */
export function itemNodeOf(
  o: THREE.Object3D | null,
  stop: THREE.Object3D | null = null,
): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  for (let n = o; n && n !== stop; n = n.parent) if (itemIdOf(n)) found = n;
  return found;
}

export function collectItems(root: THREE.Object3D): ModelItem[] {
  const out: ModelItem[] = [];
  const visit = (o: THREE.Object3D) => {
    const id = itemIdOf(o);
    if (id) {
      out.push({ id, node: o, extras: { ...(o.userData as Extras) } });
      return;
    }
    o.children.forEach(visit);
  };
  visit(root);
  return out;
}

export function isFlagged(extras: Extras): boolean {
  const f = extras.flags;
  if (Array.isArray(f)) return f.length > 0;
  if (typeof f === "string") {
    const t = f.trim();
    return t !== "" && t !== "[]";
  }
  return false;
}

export function colourKey(mode: ColourBy, extras: Extras): string | null {
  switch (mode) {
    case "material":
      return null;
    case "type":
      return str(extras.type) ?? "other";
    case "area":
      return str(extras.area) ?? "none";
    case "height_source":
      return str(extras.height_source) ?? str(extras.h_src) ?? "indicative";
    case "flag":
      return isFlagged(extras) ? "flagged" : "clean";
  }
}

/** Status colours come from tokens; categories walk the hue circle by the golden ratio. */
export function modeColour(mode: ColourBy, key: string, index: number): THREE.Color {
  if (mode === "height_source")
    return tokenColor(tokenRgb(key === "drawing" ? "ok" : key === "cloud" ? "info" : "warn"));
  if (mode === "flag") return tokenColor(tokenRgb(key === "flagged" ? "danger" : "muted"));
  return new THREE.Color().setHSL((index * GOLDEN) % 1, 0.55, 0.6, THREE.SRGBColorSpace);
}

let loader: GLTFLoader | null = null;
/** One GLTFLoader with the meshopt decoder registered (spec §15: G1 writes none, imports may). */
export function glbLoader(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

export async function loadGlb(url: string): Promise<THREE.Object3D> {
  return (await glbLoader().loadAsync(url)).scene;
}

/** Disposes a material's textures (map, normalMap, ...), which `Material.dispose` leaves alone. */
function disposeTextures(mat: THREE.Material): void {
  for (const v of Object.values(mat))
    if ((v as THREE.Texture | null)?.isTexture) (v as THREE.Texture).dispose();
}

/** Removes `o` from its parent and releases its geometries, materials and their textures. */
function disposeTree(o: THREE.Object3D): void {
  o.removeFromParent();
  const mats = new Set<THREE.Material>();
  o.traverse((c) => {
    const d = c as THREE.Mesh;
    if (d.geometry) d.geometry.dispose();
    if (d.material) materialsOf(d).forEach((m) => mats.add(m));
  });
  for (const m of mats) {
    disposeTextures(m);
    m.dispose();
  }
}

function meshesOf(node: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  node.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh);
  });
  return out;
}

const materialsOf = (m: THREE.Mesh): THREE.Material[] =>
  Array.isArray(m.material) ? m.material : [m.material];

function triangles(mesh: THREE.Mesh): number {
  const g = mesh.geometry;
  const n = g.index ? g.index.count / 3 : (g.getAttribute("position")?.count ?? 0) / 3;
  const inst = mesh as THREE.InstancedMesh;
  return n * (inst.isInstancedMesh ? inst.count : 1);
}

/**
 * The plant model layer (spec §11 "model"): one GLB at a time; colour by material, type, area, height
 * source or flag; see-through; wireframe; a horizontal cut (ruling R10); a selection outline (ruling R11).
 */
export class ModelLayer implements SiteLayer {
  readonly id = MODEL_LAYER_ID;
  readonly label: string;
  readonly root = new THREE.Group();
  readonly helpers = new THREE.Group();
  private engine: SiteEngine | null = null;
  private items: ModelItem[] = [];
  private readonly byId = new Map<string, ModelItem>();
  private readonly originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private readonly colourMats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private colourBy: ColourBy = "material";
  private opacity = 1;
  private wireframe = false;
  private cutY: number | null = null;
  private seq = 0;
  private offSelect: (() => void) | null = null;
  private wanted: string;
  private selectedId: string | null = null;
  private adopted: THREE.Object3D | null = null;

  constructor(private readonly opts: ModelLayerOptions) {
    this.label = opts.label ?? "Plant model";
    this.wanted = opts.url;
    this.root.name = "model";
    this.helpers.name = "model-selection";
  }

  async attach(e: SiteEngine): Promise<void> {
    this.engine = e;
    e.scene.add(this.root, this.helpers);
    e.addPickable({
      layerId: this.id,
      root: this.root,
      resolve: (o) => this.resolve(o),
      accepts: (p) => this.cutY === null || p.y <= this.cutY + 1e-6,
    });
    this.offSelect?.();
    this.offSelect = e.onSelect((hit: PickHit | null) =>
      this.highlight(hit && hit.layerId === this.id ? hit.itemId : null),
    );
    await this.fetchModel(this.wanted, e, false);
  }

  /** The GLB last asked for (the options' url, then each `load(url)`), whether or not it loaded. */
  get url(): string {
    return this.wanted;
  }

  /**
   * Swaps the GLB in place (ruling R-S3-10, the one swap path): the new file is parsed first and the
   * old model stays when it fails (onError, then the promise rejects). The camera is not reframed: the
   * engine fits only its first content box. A load superseded by a later one is dropped.
   */
  async load(url: string): Promise<void> {
    this.wanted = url;
    const e = this.engine;
    if (e) await this.fetchModel(url, e, true);
  }

  private async fetchModel(url: string, e: SiteEngine, rethrow: boolean): Promise<void> {
    const seq = ++this.seq;
    let info: ModelLoadInfo;
    try {
      const scene = await (this.opts.loader ?? loadGlb)(url);
      if (seq !== this.seq || this.engine !== e) {
        disposeTree(scene);
        return;
      }
      // Not `onLoad?.(this.adopt(scene))`: an optional call skips its arguments, so without onLoad
      // the model would never be adopted.
      info = this.adopt(scene);
    } catch (err) {
      if (seq !== this.seq) return;
      this.opts.onError?.(err, url);
      if (rethrow) throw err;
      return;
    }
    this.opts.onLoad?.(info, url); // outside the try: a consumer's exception is not a load error
  }

  /**
   * Selects an item by id through the engine, as a click would: every listener (this outline, the
   * screen's panels) hears a model hit at the item's box centre. Null clears. An id this model lacks
   * (an item without geometry) only clears the outline.
   */
  select(itemId: string | null): void {
    const e = this.engine;
    const it = itemId === null ? undefined : this.byId.get(itemId);
    if (!e || (itemId !== null && !it)) {
      this.highlight(null);
      return;
    }
    if (!it) {
      e.select(null);
      return;
    }
    this.root.updateMatrixWorld(true);
    const c = new THREE.Box3().setFromObject(it.node).getCenter(new THREE.Vector3());
    e.select({ layerId: this.id, itemId: it.id, point: [c.x, c.y, c.z], extras: { ...it.extras } });
  }

  /** The adopted GLB scene (a new object on every load, under `root`); null before a load and after detach. */
  get scene(): THREE.Object3D | null {
    return this.adopted;
  }

  /** Takes a parsed scene as the model (the load path, and tests). */
  adopt(scene: THREE.Object3D): ModelLoadInfo {
    this.clearModel();
    this.root.add(scene);
    this.adopted = scene;
    this.root.updateMatrixWorld(true);
    this.items = collectItems(scene);
    for (const it of this.items) if (!this.byId.has(it.id)) this.byId.set(it.id, it);
    scene.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      this.originals.set(m, m.material);
      for (const mat of materialsOf(m)) mat.side = THREE.DoubleSide;
    });
    this.applyColour();
    if (this.selectedId) {
      // An item the new version lacks: every listener (the panels too) hears the selection is gone,
      // not only this outline (S3-9 minor 1).
      if (this.byId.has(this.selectedId)) this.highlight(this.selectedId);
      else if (this.engine) this.engine.select(null);
      else this.highlight(null);
    }
    const areas = new Map<string, THREE.Box3>();
    for (const it of this.items) {
      const a = str(it.extras.area);
      if (!a) continue;
      const b = new THREE.Box3().setFromObject(it.node);
      if (b.isEmpty()) continue;
      areas.set(a, (areas.get(a) ?? new THREE.Box3()).union(b));
    }
    const e = this.engine;
    if (e) {
      e.clearPresets(this.id);
      for (const [a, b] of areas) e.setPresetBox(this.id, `area:${a}`, b);
      e.setContentBox(this.id, new THREE.Box3().setFromObject(this.root));
      e.requestRender();
    }
    return {
      items: this.byId.size,
      areas: [...areas.keys()].sort(),
      types: [...new Set(this.items.map((i) => str(i.extras.type) ?? "other"))].sort(),
    };
  }

  detach(): void {
    this.seq += 1;
    this.offSelect?.();
    this.offSelect = null;
    const e = this.engine;
    this.engine = null;
    this.clearModel();
    this.root.removeFromParent();
    this.helpers.removeFromParent();
    if (e) {
      e.removePickable(this.id);
      e.setContentBox(this.id, null);
      e.clearPresets(this.id);
    }
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
    this.helpers.visible = v;
    this.engine?.requestRender();
  }

  /** See-through: below 1 the model is transparent and stops writing depth. */
  setOpacity(o: number): void {
    this.opacity = Math.min(1, Math.max(0, o));
    this.applyMaterialState();
  }

  setWireframe(on: boolean): void {
    this.wireframe = on;
    this.applyMaterialState();
  }

  /** Keeps what is at or below scene height `y`; null removes the cut. */
  setCut(y: number | null): void {
    this.cutY = y;
    if (y !== null) this.cutPlane.constant = y;
    this.applyMaterialState();
    this.applyHelperCut();
  }

  setColourBy(mode: ColourBy): void {
    this.colourBy = mode;
    this.applyColour();
  }

  itemIds(): string[] {
    return [...this.byId.keys()];
  }

  itemBox(id: string): THREE.Box3 | null {
    const it = this.byId.get(id);
    return it ? new THREE.Box3().setFromObject(it.node) : null;
  }

  private resolve(o: THREE.Object3D): { itemId: string; extras: Extras } | null {
    const n = itemNodeOf(o, this.root);
    const id = n ? itemIdOf(n) : null;
    return n && id ? { itemId: id, extras: { ...(n.userData as Extras) } } : null;
  }

  private applyColour(): void {
    const keys = [
      ...new Set(
        this.items.map((it) => colourKey(this.colourBy, it.extras)).filter((k): k is string => k !== null),
      ),
    ].sort();
    for (const it of this.items) {
      const key = colourKey(this.colourBy, it.extras);
      for (const mesh of meshesOf(it.node)) {
        const original = this.originals.get(mesh);
        if (!original) continue;
        mesh.material = key === null ? original : this.colourMaterial(key, keys.indexOf(key));
      }
    }
    this.applyMaterialState();
  }

  private colourMaterial(key: string, index: number): THREE.MeshStandardMaterial {
    const ck = `${this.colourBy}:${key}`;
    let m = this.colourMats.get(ck);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: modeColour(this.colourBy, key, index),
        roughness: 0.85,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      this.colourMats.set(ck, m);
    }
    return m;
  }

  private applyMaterialState(): void {
    const seen = new Set<THREE.Material>();
    this.root.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) materialsOf(m).forEach((mat) => seen.add(mat));
    });
    const transparent = this.opacity < 1;
    for (const mat of seen) {
      if (mat.transparent !== transparent) mat.needsUpdate = true;
      mat.transparent = transparent;
      mat.opacity = this.opacity;
      mat.depthWrite = !transparent;
      if ("wireframe" in mat) (mat as THREE.MeshStandardMaterial).wireframe = this.wireframe;
      mat.clippingPlanes = this.cutY === null ? null : [this.cutPlane];
    }
    this.engine?.requestRender();
  }

  private highlight(id: string | null): void {
    this.selectedId = id;
    disposeChildren(this.helpers);
    const it = id ? this.byId.get(id) : undefined;
    if (it) {
      this.root.updateMatrixWorld(true);
      const colour = tokenColor(tokenRgb("accent"));
      const ms = meshesOf(it.node);
      const heavy =
        ms.some((m) => (m as THREE.InstancedMesh).isInstancedMesh) ||
        ms.reduce((n, m) => n + triangles(m), 0) > OUTLINE_MAX_TRIANGLES;
      if (heavy) {
        const box = new THREE.Box3Helper(new THREE.Box3().setFromObject(it.node), colour);
        box.raycast = () => {};
        this.addHelper(box);
      } else {
        for (const m of ms) {
          const line = new THREE.LineSegments(
            new THREE.EdgesGeometry(m.geometry, 30),
            new THREE.LineBasicMaterial({ color: colour, depthTest: false, transparent: true }),
          );
          line.raycast = () => {};
          line.matrixAutoUpdate = false;
          line.matrix.copy(m.matrixWorld);
          this.addHelper(line);
        }
      }
    }
    this.applyHelperCut();
    this.engine?.requestRender();
  }

  /** The outline is cut with the model, so it never draws what the cut hides. */
  private applyHelperCut(): void {
    this.helpers.traverse((c) => {
      const mat = (c as THREE.LineSegments).material as THREE.Material | undefined;
      if (mat && !Array.isArray(mat)) mat.clippingPlanes = this.cutY === null ? null : [this.cutPlane];
    });
    this.engine?.requestRender();
  }

  private addHelper(o: THREE.Object3D): void {
    o.renderOrder = 999;
    o.userData.kind = "selection";
    this.helpers.add(o);
  }

  private clearModel(): void {
    for (const [mesh, original] of this.originals) mesh.material = original; // dispose the real ones
    disposeChildren(this.helpers);
    for (const child of [...this.root.children]) disposeTree(child);
    for (const m of this.colourMats.values()) m.dispose();
    this.colourMats.clear();
    this.items = [];
    this.byId.clear();
    this.originals.clear();
    this.adopted = null;
  }
}

export function createModelLayer(opts: ModelLayerOptions): ModelLayer {
  return new ModelLayer(opts);
}
