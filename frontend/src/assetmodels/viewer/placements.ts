// Placements (spec §9 setPlacements, §11 "patch binaries are fetched per visible patch"): the
// paged index becomes items; a patch's mesh, texture and label grid are fetched only once the
// patch's bounding sphere is inside the view frustum, nearest first, at most 6 at a time, and are
// kept once loaded. A 715-patch facade never downloads what the operator has not looked at.
import * as THREE from "three";
import type { components } from "@contract/client";
import { severityOf, type SeverityLevel } from "@/ui/severityScale";
import type { Vec3 } from "./pins";

type Placement = components["schemas"]["Placement"];

export interface PlacementItem {
  sightingId: string;
  /** null while the sighting is ungrouped. */
  findingId: string | null;
  kind: "point" | "patch";
  center: Vec3;
  normal: Vec3 | null;
  /** Largest extent in metres (0 for a pin). */
  size: number;
  severity: number | null;
  /** #rrggbb from the severity scale (a data colour). */
  colour: string;
  /** The patch's mesh, texture and label files exist; a patch row without them is never fetched. */
  hasPatch: boolean;
}

export interface PatchBuffers {
  mesh: ArrayBuffer;
  texture: Blob;
  labels: ArrayBuffer;
}

export type FetchPatch = (sightingId: string) => Promise<PatchBuffers>;

export interface Sphere {
  center: Vec3;
  radius: number;
}

export const MAX_PATCH_FETCHES = 6;

const v3 = (a: readonly number[]): Vec3 => [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];

export function placementItems(
  rows: readonly Placement[],
  scale: readonly SeverityLevel[],
  fallback: string,
): PlacementItem[] {
  const out: PlacementItem[] = [];
  for (const r of rows) {
    if ((r.kind !== "point" && r.kind !== "patch") || !r.center) continue;
    const size: unknown = r.size;
    out.push({
      sightingId: r.sighting_id,
      findingId: r.finding_id ?? null,
      kind: r.kind,
      center: v3(r.center),
      normal: r.normal ? v3(r.normal) : null,
      size: Array.isArray(size) ? Math.max(...(size as number[])) : typeof size === "number" ? size : 0,
      severity: r.severity ?? null,
      colour: severityOf(scale, r.severity ?? null)?.colour ?? fallback,
      hasPatch: r.has_patch === true,
    });
  }
  return out;
}

export function frustumOf(camera: THREE.Camera): THREE.Frustum {
  camera.updateMatrixWorld();
  const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return new THREE.Frustum().setFromProjectionMatrix(m);
}

export class PatchLoader {
  private readonly loaded = new Set<string>();
  private readonly pending = new Set<string>();
  private readonly failed = new Set<string>();
  private disposed = false;
  private last: {
    items: readonly PlacementItem[];
    isVisible: (s: Sphere) => boolean;
    distance: (c: Vec3) => number;
  } | null = null;

  constructor(
    private readonly fetchPatch: FetchPatch,
    private readonly onLoaded: (sightingId: string, b: PatchBuffers) => void,
    private readonly max = MAX_PATCH_FETCHES,
  ) {}

  get inFlight(): number {
    return this.pending.size;
  }

  has(sightingId: string): boolean {
    return this.loaded.has(sightingId);
  }

  update(
    items: readonly PlacementItem[],
    isVisible: (s: Sphere) => boolean,
    distance: (c: Vec3) => number = () => 0,
  ): void {
    if (this.disposed) return;
    this.last = { items, isVisible, distance };
    const free = this.max - this.pending.size;
    if (free <= 0) return;
    const wanted = items
      .filter(
        (p) =>
          p.kind === "patch" &&
          p.hasPatch &&
          !this.loaded.has(p.sightingId) &&
          !this.pending.has(p.sightingId) &&
          !this.failed.has(p.sightingId) &&
          isVisible({ center: p.center, radius: Math.max(p.size, 0.05) }),
      )
      .sort((a, b) => distance(a.center) - distance(b.center))
      .slice(0, free);
    for (const p of wanted) this.start(p.sightingId);
  }

  private start(id: string): void {
    this.pending.add(id);
    this.fetchPatch(id).then(
      (b) => {
        this.pending.delete(id);
        if (this.disposed) return;
        this.loaded.add(id);
        this.onLoaded(id, b);
        this.pump();
      },
      () => {
        this.pending.delete(id);
        if (this.disposed) return;
        // a missing or broken patch file is skipped for this loader's life, never refetched per frame
        this.failed.add(id);
        this.pump();
      },
    );
  }

  private pump(): void {
    if (this.last) this.update(this.last.items, this.last.isVisible, this.last.distance);
  }

  dispose(): void {
    this.disposed = true;
    this.last = null;
  }
}
