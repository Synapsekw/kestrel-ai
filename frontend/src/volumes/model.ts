/**
 * Pure helpers of the Volumes screen (spec 2026-09-23-volumes section 9): labels per base kind, the
 * ± text, the stale banner, run grouping by flight, the build dialog's defaults, the north-up
 * pixel <-> native conversion and the "View in 3D" link. No React, no network: vitest covers them.
 */
import proj4 from "proj4";
import type { GeoMap, MapRun, Surface, VolumeMeasurement, components } from "@contract/client";

type S = components["schemas"];
export type BaseKind = S["VolumeBaseKind"];
type Uncertainty = S["VolumeUncertainty"];
type Warning = S["VolumeWarning"];
type SurfaceRef = S["SurfaceRef"];
type BuildRequest = S["SurfaceBuildRequest"];
type BuildMethod = S["SurfaceBuildMethod"];

export const BASE_KIND_TEXT: Record<BaseKind, string> = {
  toe_plane: "Stockpile toe — plane",
  toe_surface: "Stockpile toe — fitted surface",
  flat: "Flat level",
  surface: "Another surface",
};

export interface Labels {
  fill: string;
  cut: string;
  headline: "fill" | "net" | "both";
}

/** Section 6.1: the same fill, cut and net, named for what they mean against this base. */
export function labels(kind: BaseKind, base?: Pick<SurfaceRef, "kind" | "captured_on"> | null): Labels {
  if (kind !== "surface")
    return { fill: "Stockpile volume (above base)", cut: "Below base", headline: "fill" };
  if (base?.kind === "design")
    return { fill: "Above design (to cut)", cut: "Below design (to fill)", headline: "both" };
  const when = base?.captured_on ?? "the earlier survey";
  return { fill: `Added since ${when} (fill)`, cut: `Removed since ${when} (cut)`, headline: "net" };
}

const nf = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** "1 234.5 m³": the app's thin grouping (MapsScreen writes pixel counts the same way). */
export function formatM3(v: number | null | undefined): string {
  return v == null ? "—" : `${nf.format(v).replace(/,/g, " ")} m³`;
}

export function formatM2(v: number | null | undefined): string {
  return v == null ? "—" : `${nf.format(v).replace(/,/g, " ")} m²`;
}

export function uncertaintyText(u: Uncertainty): string {
  if (u.total_m3 == null) return "± unknown (indicative, incomplete)";
  return `± ${formatM3(u.total_m3)} (indicative${u.complete ? "" : ", incomplete"})`;
}

export function staleText(reasons: string[]): string {
  return reasons.length
    ? `Inputs changed: ${reasons.join(", ")} — Recalculate`
    : "Inputs changed — Recalculate";
}

export function worstTone(warnings: Warning[]): "ok" | "warn" | "danger" {
  if (warnings.some((w) => w.severity === "danger")) return "danger";
  return warnings.length ? "warn" : "ok";
}

export interface RunGroup {
  title: string;
  runs: MapRun[];
}

/** Section 6.5: runs grouped by where the machines were seen; other flights come last. */
export function groupRuns(runs: MapRun[], topMapId: string | null, baseMapId: string | null): RunGroup[] {
  const done = runs.filter((r) => r.state === "succeeded");
  const groups: RunGroup[] = [
    { title: "Same flight as top", runs: done.filter((r) => topMapId && r.map_id === topMapId) },
    {
      title: "Same flight as base",
      runs: done.filter((r) => baseMapId && r.map_id === baseMapId && r.map_id !== topMapId),
    },
    { title: "Other maps", runs: done.filter((r) => r.map_id !== topMapId && r.map_id !== baseMapId) },
  ];
  return groups.filter((g) => g.runs.length > 0);
}

export const METHODS: { value: BuildMethod; label: string; bias: string }[] = [
  {
    value: "median",
    label: "Median — recommended",
    bias: "Within 0.1–0.4 % of the true volume in tests, even with stray points.",
  },
  {
    value: "mean",
    label: "Mean",
    bias: "Close to the median, but stray points pull it: +0.8 % with 0.1 % outliers.",
  },
  {
    value: "max",
    label: "Highest",
    bias: "Models the top of the noise: overstates stockpiles by 2–7 %. For structures.",
  },
  { value: "min", label: "Lowest", bias: "Understates stockpiles by 2–4 %." },
];

export const CELL_LADDER = [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2];

export interface BuildForm {
  pointCloudId: string;
  name: string;
  method: BuildMethod;
  cell: "auto" | number;
  holeFillM: number;
  despikeOn: boolean;
  despikeM: number;
  zClip: [number, number] | null;
  dropNoise: boolean;
  assumeMetres: boolean;
}

export function buildDefaults(cloud: { id: string; name: string }): BuildForm {
  return {
    pointCloudId: cloud.id,
    name: `${cloud.name} surface`,
    method: "median",
    cell: "auto",
    holeFillM: 1,
    despikeOn: true,
    despikeM: 1,
    zClip: null,
    dropNoise: true,
    assumeMetres: false,
  };
}

/** Only what differs from the server's defaults is sent (section 5.1 resolves the rest). */
export function buildRequest(f: BuildForm): BuildRequest {
  const body: BuildRequest = { point_cloud_id: f.pointCloudId, name: f.name, method: f.method };
  if (f.cell !== "auto") body.cell_size_m = f.cell;
  if (f.holeFillM !== 1) body.hole_fill_max_gap_m = f.holeFillM;
  if (!f.despikeOn) body.despike_m = null;
  else if (f.despikeM !== 1) body.despike_m = f.despikeM;
  if (f.zClip) body.z_clip = f.zClip;
  if (!f.dropNoise) body.drop_noise_classes = false;
  if (f.assumeMetres) body.assume_metres = true;
  return body;
}

/** A ready surface's grid in the shape `makeTileGrid` and `olExtent` take (they were written for maps). */
export function surfaceGrid(s: Surface): Pick<GeoMap, "width" | "height" | "tile_grid"> {
  return {
    width: s.width ?? 0,
    height: s.height ?? 0,
    tile_grid: s.tile_grid ?? { tile_size: 256, max_zoom: 0 },
  };
}

/** North-up geotransform: native (x, y) -> surface pixel (px, py), y down. */
export function nativeToPixel(gt: number[], x: number, y: number): [number, number] {
  return [(x - gt[0]) / gt[1], (y - gt[3]) / gt[5]];
}

export function pixelToNative(gt: number[], px: number, py: number): [number, number] {
  return [gt[0] + px * gt[1], gt[3] + py * gt[5]];
}

export function ringToNative(gt: number[], pixels: number[][]): number[][] {
  return pixels.map(([px, py]) => pixelToNative(gt, px, py));
}

export function ringToPixels(gt: number[], ring: number[][]): number[][] {
  return ring.map(([x, y]) => nativeToPixel(gt, x, y));
}

/** The polygon's area-weighted centroid and its bbox corners (native). */
export function centroidAndCorners(ring: number[][]): { at: [number, number]; corners: number[][] } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const k = x0 * y1 - x1 * y0;
    a += k;
    cx += (x0 + x1) * k;
    cy += (y0 + y1) * k;
  }
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const [minx, maxx, miny, maxy] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const at: [number, number] = a ? [cx / (3 * a), cy / (3 * a)] : [(minx + maxx) / 2, (miny + maxy) / 2];
  return {
    at,
    corners: [
      [minx, miny],
      [maxx, miny],
      [maxx, maxy],
      [minx, maxy],
    ],
  };
}

/**
 * S1's canonical 3D link (point-clouds spec section 10): coordinates in the **cloud's** CRS. The
 * surface's CRS is the cloud's unless the build reprojected a geographic cloud; then the points
 * are converted back with proj4 (only EPSG:4326 is known without a definition). Null when there is
 * no cloud to open.
 */
export function viewIn3dHref(projectId: string, surface: Surface, ring: number[][]): string | null {
  if (surface.kind !== "cloud_dsm" || !surface.point_cloud_id) return null;
  const { at, corners } = centroidAndCorners(ring);
  let convert = (p: number[]) => p;
  const from = surface.stats?.reprojected_from_epsg;
  if (from != null) {
    if (from !== 4326 || !surface.proj4) return null;
    const t = proj4(surface.proj4, "EPSG:4326");
    convert = (p) => t.forward([p[0], p[1]]);
  }
  const fmt = (p: number[]) => {
    const [x, y] = convert(p);
    const digits = from != null ? 7 : 3;
    return `${x.toFixed(digits)},${y.toFixed(digits)}`;
  };
  return `/p/${projectId}/clouds/${surface.point_cloud_id}?at=${fmt(at)}&fp=${corners.map(fmt).join(";")}`;
}

/** Export offers only ready measurements; a stale or failed one says why. */
export function exportState(m: VolumeMeasurement): { enabled: boolean; reason: string | null } {
  if (m.status === "ready") return { enabled: true, reason: null };
  if (m.status === "stale") return { enabled: false, reason: "inputs changed — recalculate first" };
  if (m.status === "calculating") return { enabled: false, reason: "still calculating" };
  return { enabled: false, reason: m.error ?? "the calculation failed" };
}

/** "Pile 3": the first free number. */
export function nextName(measurements: Pick<VolumeMeasurement, "name">[]): string {
  const used = new Set(measurements.map((m) => m.name));
  let n = measurements.length + 1;
  while (used.has(`Pile ${n}`)) n += 1;
  return `Pile ${n}`;
}

/** The measurement's headline number in the list: fill, net or both, by base kind. */
export function headline(m: VolumeMeasurement): string {
  const r = m.results;
  if (!r) return "—";
  const lab = labels(m.base.kind, r.base_surface);
  if (lab.headline === "net") return `net ${formatM3(r.net_m3)}`;
  if (lab.headline === "both") return `${formatM3(r.fill_m3)} / ${formatM3(r.cut_m3)}`;
  return formatM3(r.fill_m3);
}
