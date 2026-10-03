import * as THREE from "three";
import { siteRes, tileBounds, type SiteExtent, type SiteTile } from "@/mapws/view/siteGrid";
import { siteToPlant, type SiteFrameT } from "./siteTransform";

/**
 * Site tiles draped in 3D (spec 2026-10-03 §11; plan S1 rulings R7, R9). The site tile grid is
 * mapws/view/siteGrid.ts; this module picks which tiles a camera needs (a screen-space-error quadtree),
 * places each as a quad in the scene, and keeps their textures in one cache shared by every drape layer:
 * ≤ 256 live tiles of 256 × 256 RGBA without mipmaps, so ≤ 64 MiB (index Global Constraints).
 */
export const MAX_LIVE_TILES = 256;
export const TILE_BYTES = 256 * 256 * 4;
export const MAX_TILE_BYTES = MAX_LIVE_TILES * TILE_BYTES;
export const MAX_IN_FLIGHT = 6;
export const MAX_ROOTS = 16;
/** Refine while one texel covers more than this many screen pixels. */
export const REFINE_FACTOR = 1.5;
export const Z0_SPAN_M = 256 * 1024;

export interface TileView {
  /** Radians per screen pixel. */
  pixelAngle: number;
  /** Metres from the camera to the nearest part of the tile, in the scene. */
  distanceTo(t: SiteTile): number;
}

export function tileKey(t: SiteTile): string {
  return `${t.z}/${t.x}/${t.y}`;
}

export function fillTemplate(template: string, t: SiteTile): string {
  return template.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y));
}

const intersects = (a: SiteExtent, b: SiteExtent) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

export function rootTiles(b: SiteExtent, z: number): SiteTile[] {
  const s = 256 * siteRes(z);
  const x0 = Math.floor(b[0] / s);
  const x1 = Math.max(x0, Math.ceil(b[2] / s) - 1);
  const y0 = Math.floor(-b[3] / s);
  const y1 = Math.max(y0, Math.ceil(-b[1] / s) - 1);
  const out: SiteTile[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x: x + 0, y: y + 0 });
  return out;
}

export function childTiles(t: SiteTile, b: SiteExtent): SiteTile[] {
  const out: SiteTile[] = [];
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++) {
      const k = { z: t.z + 1, x: t.x * 2 + dx, y: t.y * 2 + dy };
      if (intersects(tileBounds(k), b)) out.push(k);
    }
  return out;
}

export function parentTile(t: SiteTile): SiteTile | null {
  return t.z === 0 ? null : { z: t.z - 1, x: Math.floor(t.x / 2), y: Math.floor(t.y / 2) };
}

/** Plan ruling R7 (mirrors site_scene.min_zoom_for): the zoom where one tile spans the longer side. */
export function minZoomFor(b: SiteExtent, maxZ: number): number {
  const side = Math.max(b[2] - b[0], b[3] - b[1], 1e-6);
  return Math.max(0, Math.min(Math.floor(Math.log2(Z0_SPAN_M / side)), maxZ));
}

/**
 * The leaves to draw: start from ≤ MAX_ROOTS tiles at `minZ` (coarser when the bounds need more), then
 * split the leaf with the largest screen-space error until every leaf is sharp enough, reaches `maxZ`,
 * or one more split would pass `cap`.
 */
export function selectTiles(
  b: SiteExtent,
  minZ: number,
  maxZ: number,
  view: TileView,
  cap = MAX_LIVE_TILES,
): SiteTile[] {
  let z0 = Math.max(0, Math.min(minZ, maxZ));
  let leaves = rootTiles(b, z0);
  while (leaves.length > MAX_ROOTS && z0 > 0) {
    z0 -= 1;
    leaves = rootTiles(b, z0);
  }
  if (leaves.length > cap) return leaves.slice(0, cap);
  const err = (t: SiteTile) => siteRes(t.z) / (view.distanceTo(t) * view.pixelAngle);
  let errs = leaves.map(err);
  for (;;) {
    let best = -1;
    let bestErr = REFINE_FACTOR;
    for (let i = 0; i < leaves.length; i++) {
      if (leaves[i].z >= maxZ) continue;
      if (errs[i] > bestErr) {
        bestErr = errs[i];
        best = i;
      }
    }
    if (best < 0) return leaves;
    const kids = childTiles(leaves[best], b);
    if (leaves.length - 1 + kids.length > cap) return leaves;
    leaves = [...leaves.slice(0, best), ...kids, ...leaves.slice(best + 1)];
    errs = [...errs.slice(0, best), ...kids.map(err), ...errs.slice(best + 1)];
  }
}

export function tileView(
  f: SiteFrameT,
  cam: { x: number; y: number; z: number },
  fovDeg: number,
  viewportPx: number,
  sceneY: number,
): TileView {
  return {
    pixelAngle: (fovDeg * Math.PI) / 180 / Math.max(viewportPx, 1),
    distanceTo(t) {
      const [minx, miny, maxx, maxy] = tileBounds(t);
      const [e, n] = siteToPlant(f, (minx + maxx) / 2, (miny + maxy) / 2);
      const half = Math.hypot(maxx - minx, maxy - miny) / 2;
      const d = Math.hypot(cam.x - n, cam.y - sceneY, cam.z - e);
      return Math.max(d - half, Math.abs(cam.y - sceneY), 0.01);
    },
  };
}

/**
 * A tile as a quad at scene height `sceneY`: corners NW, NE, SE, SW with uvs (0,0) (1,0) (1,1) (0,1).
 * Textures are uploaded with flipY off, so v = 0 is the image's top row (north): ruling R9.
 */
export function tileQuad(
  f: SiteFrameT,
  t: SiteTile,
  sceneY: number,
): { positions: Float32Array; uvs: Float32Array } {
  const [minx, miny, maxx, maxy] = tileBounds(t);
  const corners: [number, number][] = [
    [minx, maxy],
    [maxx, maxy],
    [maxx, miny],
    [minx, miny],
  ];
  const positions = new Float32Array(12);
  corners.forEach(([x, y], i) => {
    const [e, n] = siteToPlant(f, x, y);
    positions.set([n, sceneY, e], i * 3);
  });
  return { positions, uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) };
}

export interface TileImage {
  width: number;
  height: number;
  close?(): void;
}
export type TileFetch = (url: string, signal: AbortSignal) => Promise<TileImage | null>;
/** A 404 or 410: the layer was deleted (siteTileLoader.ts's "gone"). */
export class GoneError extends Error {}

/** Fetch, not `<img>`, so a 204 reads as an empty tile and a 404/410 as a gone layer (ruling R9). */
export async function fetchSiteTile(url: string, signal: AbortSignal): Promise<TileImage | null> {
  const res = await fetch(url, { signal });
  if (res.status === 204) return null;
  if (res.status === 404 || res.status === 410) throw new GoneError(url);
  if (res.status !== 200) throw new Error(`tile answered ${res.status}`);
  return createImageBitmap(await res.blob());
}

export function makeTexture(image: TileImage): THREE.Texture {
  const t = new THREE.Texture(image as unknown as HTMLImageElement);
  t.flipY = false;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

type State = "queued" | "loading" | "ready" | "empty" | "error";
interface Entry {
  url: string;
  state: State;
  texture: THREE.Texture | null;
  image: TileImage | null;
  wantedAt: number;
  abort: AbortController | null;
  onGone: (() => void) | null;
}

/**
 * The drape's texture cache, shared by every tile layer. Each frame: `beginFrame`, the layers' `want`
 * and `peek` calls, `endFrame`. Queued, loading and ready entries count toward `capacity`. A new tile
 * evicts the least recently wanted ready or queued tile that this frame did not want, or is refused
 * (the layer draws an ancestor instead). Empty (204) and failed tiles are remembered without counting.
 */
export class TileCache {
  private readonly entries = new Map<string, Entry>();
  private queue: string[] = [];
  private inFlight = 0;
  private frameNo = 0;
  private disposed = false;

  constructor(
    private readonly fetchTile: TileFetch,
    private readonly onChange: () => void,
    readonly capacity = MAX_LIVE_TILES,
    readonly maxInFlight = MAX_IN_FLIGHT,
  ) {}

  beginFrame(): void {
    this.frameNo += 1;
    this.queue = [];
  }

  want(url: string, onGone?: () => void): THREE.Texture | null {
    if (this.disposed) return null;
    let e = this.entries.get(url);
    if (!e) {
      if (!this.makeRoom()) return null;
      e = {
        url,
        state: "queued",
        texture: null,
        image: null,
        wantedAt: this.frameNo,
        abort: null,
        onGone: onGone ?? null,
      };
      this.entries.set(url, e);
    }
    e.wantedAt = this.frameNo;
    if (e.state === "queued" && !this.queue.includes(url)) this.queue.push(url);
    this.pump();
    return e.texture;
  }

  /** A ready texture (an ancestor drawn while its children load), marked wanted; never fetches. */
  peek(url: string): THREE.Texture | null {
    const e = this.entries.get(url);
    if (!e || !e.texture) return null;
    e.wantedAt = this.frameNo;
    return e.texture;
  }

  live(): number {
    let n = 0;
    for (const e of this.entries.values())
      if (e.state === "queued" || e.state === "loading" || e.state === "ready") n++;
    return n;
  }

  bytes(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.state === "ready") n++;
    return n * TILE_BYTES;
  }

  endFrame(): void {
    for (const e of [...this.entries.values()]) {
      if (e.state === "queued" && e.wantedAt < this.frameNo) this.entries.delete(e.url);
    }
    const quiet = [...this.entries.values()].filter((e) => e.state === "empty" || e.state === "error");
    if (quiet.length > this.capacity * 4) {
      quiet
        .sort((a, b) => a.wantedAt - b.wantedAt)
        .slice(0, quiet.length - this.capacity * 4)
        .forEach((e) => this.entries.delete(e.url));
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const e of [...this.entries.values()]) this.drop(e);
    this.queue = [];
  }

  private makeRoom(): boolean {
    if (this.live() < this.capacity) return true;
    let victim: Entry | null = null;
    for (const e of this.entries.values()) {
      if ((e.state === "ready" || e.state === "queued") && e.wantedAt < this.frameNo) {
        if (!victim || e.wantedAt < victim.wantedAt) victim = e;
      }
    }
    if (!victim) return false;
    this.drop(victim);
    return true;
  }

  private drop(e: Entry): void {
    e.abort?.abort();
    e.texture?.dispose();
    e.image?.close?.();
    this.entries.delete(e.url);
  }

  private pump(): void {
    while (this.inFlight < this.maxInFlight && this.queue.length > 0) {
      const url = this.queue.shift()!;
      const e = this.entries.get(url);
      if (!e || e.state !== "queued") continue;
      e.state = "loading";
      e.abort = new AbortController();
      this.inFlight += 1;
      this.fetchTile(url, e.abort.signal)
        .then(
          (image) => {
            if (this.entries.get(url) !== e) {
              image?.close?.();
              return;
            }
            if (image) {
              e.image = image;
              e.texture = makeTexture(image);
              e.state = "ready";
            } else e.state = "empty";
          },
          (err: unknown) => {
            if (this.entries.get(url) !== e) return;
            e.state = "error";
            if (err instanceof GoneError) e.onGone?.();
          },
        )
        .finally(() => {
          this.inFlight -= 1;
          e.abort = null;
          if (this.disposed) return;
          this.pump();
          this.onChange();
        });
    }
  }
}
