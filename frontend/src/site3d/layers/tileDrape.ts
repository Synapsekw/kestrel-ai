import * as THREE from "three";
import type { SiteExtent, SiteTile } from "@/mapws/view/siteGrid";
import type { SiteEngine } from "../engine/SiteEngine";
import { siteToPlant, type SiteFrameT } from "../engine/siteTransform";
import { fillTemplate, parentTile, selectTiles, tileKey, tileQuad, tileView } from "../engine/tiles";
import type { SiteLayer } from "./types";

export interface DrapeSpec {
  id: string;
  label: string;
  /** Absolute, token-bearing, with `{z}/{x}/{y}` left in. */
  template: string;
  bounds: SiteExtent;
  minZ: number;
  maxZ: number;
  /** Scene height of the drape plane (y = EL − datum). */
  sceneY: number;
  renderOrderBase: number;
  opacity: number;
}

const QUAD_INDEX = [0, 1, 2, 0, 2, 3];

export function extent(b: readonly number[]): SiteExtent {
  return [b[0], b[1], b[2], b[3]];
}

/**
 * Site tiles draped on a horizontal plane (spec §11 ortho and drawing layers, ruling R9). Each frame it
 * picks the tiles the camera needs (≤ the engine's tile budget shared among visible drapes), draws the
 * loaded ones, and stands in the nearest loaded ancestor for a tile still loading.
 */
export class TileDrapeLayer implements SiteLayer {
  readonly isTileDrape = true;
  readonly id: string;
  readonly label: string;
  readonly group = new THREE.Group();
  private engine: SiteEngine | null = null;
  private readonly meshes = new Map<string, THREE.Mesh>();
  private opacity: number;
  private visible = true;
  private gone = false;

  constructor(
    private readonly spec: DrapeSpec,
    private readonly onGone?: () => void,
  ) {
    this.id = spec.id;
    this.label = spec.label;
    this.opacity = spec.opacity;
    this.group.name = spec.id;
  }

  get shown(): boolean {
    return this.visible && !this.gone;
  }

  attach(e: SiteEngine): void {
    if (!e.frame) return;
    this.engine = e;
    this.group.visible = this.visible;
    e.scene.add(this.group);
    e.setContentBox(this.id, this.contentBox(e.frame));
    e.requestRender();
  }

  detach(): void {
    const e = this.engine;
    this.engine = null;
    this.clear();
    this.group.removeFromParent();
    e?.setContentBox(this.id, null);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.group.visible = v;
    this.engine?.requestRender();
  }

  setOpacity(o: number): void {
    this.opacity = Math.min(1, Math.max(0, o));
    for (const m of this.meshes.values()) (m.material as THREE.MeshBasicMaterial).opacity = this.opacity;
    this.engine?.requestRender();
  }

  update(_dt: number, camera: THREE.Camera): void {
    const e = this.engine;
    const frame = e?.frame;
    if (!e || !frame || !this.shown) return;
    const cam = camera as THREE.PerspectiveCamera;
    const view = tileView(frame, cam.position, cam.fov, e.viewportHeight(), this.spec.sceneY);
    const cap = Math.max(1, Math.floor(e.tiles.capacity / e.drapeCount()));
    const wanted = selectTiles(this.spec.bounds, this.spec.minZ, this.spec.maxZ, view, cap);
    const draw = new Map<string, { tile: SiteTile; texture: THREE.Texture }>();
    for (const t of wanted) {
      const texture = e.tiles.want(fillTemplate(this.spec.template, t), this.markGone);
      if (texture) {
        draw.set(tileKey(t), { tile: t, texture });
        continue;
      }
      for (let p = parentTile(t); p; p = parentTile(p)) {
        const pt = e.tiles.peek(fillTemplate(this.spec.template, p));
        if (pt) {
          draw.set(tileKey(p), { tile: p, texture: pt });
          break;
        }
      }
    }
    this.sync(draw, frame);
  }

  /** The cache calls this once per failing tile; the layer reports gone only once. */
  private readonly markGone = (): void => {
    if (this.gone) return;
    this.gone = true;
    this.clear();
    this.onGone?.();
    this.engine?.requestRender();
  };

  private sync(draw: Map<string, { tile: SiteTile; texture: THREE.Texture }>, frame: SiteFrameT): void {
    for (const [k, mesh] of [...this.meshes]) {
      const want = draw.get(k);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (!want || mat.map !== want.texture) this.removeMesh(k, mesh);
    }
    for (const [k, { tile, texture }] of draw) {
      if (this.meshes.has(k)) continue;
      const q = tileQuad(frame, tile, this.spec.sceneY);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(q.positions, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(q.uvs, 2));
      geo.setIndex(QUAD_INDEX);
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: this.opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = this.spec.renderOrderBase + tile.z;
      mesh.userData.tile = k;
      this.meshes.set(k, mesh);
      this.group.add(mesh);
    }
  }

  private removeMesh(k: string, mesh: THREE.Mesh): void {
    this.group.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose(); // the texture is the cache's
    this.meshes.delete(k);
  }

  private clear(): void {
    for (const [k, m] of [...this.meshes]) this.removeMesh(k, m);
  }

  private contentBox(frame: SiteFrameT): THREE.Box3 {
    const [minx, miny, maxx, maxy] = this.spec.bounds;
    const pts = [
      [minx, miny],
      [maxx, miny],
      [maxx, maxy],
      [minx, maxy],
    ].map(([x, y]) => {
      const [e, n] = siteToPlant(frame, x, y);
      return new THREE.Vector3(n, this.spec.sceneY, e);
    });
    return new THREE.Box3().setFromPoints(pts);
  }
}
