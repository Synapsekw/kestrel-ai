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
  onLoad?(info: ModelLoadInfo): void;
  onError?(err: unknown): void;
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

  constructor(private readonly opts: ModelLayerOptions) {
    this.label = opts.label ?? "Plant model";
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
    this.offSelect = e.onSelect((hit: PickHit | null) =>
      this.highlight(hit && hit.layerId === this.id ? hit.itemId : null),
    );
    const seq = ++this.seq;
    try {
      const scene = await (this.opts.loader ?? loadGlb)(this.opts.url);
      if (seq !== this.seq || this.engine !== e) {
        const orphan = new THREE.Group();
        orphan.add(scene);
        disposeChildren(orphan);
        return;
      }
      this.opts.onLoad?.(this.adopt(scene));
    } catch (err) {
      if (seq === this.seq) this.opts.onError?.(err);
    }
  }

  /** Takes a parsed scene as the model (the load path, and tests). */
  adopt(scene: THREE.Object3D): ModelLoadInfo {
    this.clearModel();
    this.root.add(scene);
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
        this.addHelper(new THREE.Box3Helper(new THREE.Box3().setFromObject(it.node), colour));
      } else {
        for (const m of ms) {
          const line = new THREE.LineSegments(
            new THREE.EdgesGeometry(m.geometry, 30),
            new THREE.LineBasicMaterial({ color: colour, depthTest: false, transparent: true }),
          );
          line.matrixAutoUpdate = false;
          line.matrix.copy(m.matrixWorld);
          this.addHelper(line);
        }
      }
    }
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
    disposeChildren(this.root);
    for (const m of this.colourMats.values()) m.dispose();
    this.colourMats.clear();
    this.items = [];
    this.byId.clear();
    this.originals.clear();
  }
}

export function createModelLayer(opts: ModelLayerOptions): ModelLayer {
  return new ModelLayer(opts);
}
