import type { CloudMeasurementKind, CloudMeasurementParams } from "@contract/client";
import type { CloudMeasurement, CloudMeasurementCreate } from "@/api/cloudMeasurements";
import {
  KIND_LABEL,
  MeasureRefusal,
  NEEDS_PROJECTED_CRS,
  NON_COPLANAR_NOTE,
  fitRing,
  isNonCoplanar,
  measureRefusal,
  measureResults,
  overlayShapes,
  refusal,
  type ComputableKind,
  type MeasureKind,
  type MPoint,
  type RingFit,
} from "../measure";
import { formatLength } from "../readout";
import {
  DEFAULT_THICKNESS_M,
  INITIAL_TOOL,
  isComplete,
  isRings,
  type CloudToolState,
  type ToolKind,
} from "../useCloudTool";
import type { Vec3 as XYZ } from "../viewer/camera";
import type { OverlayShape } from "../viewer/overlay";
import type { CloudToolId } from "../workspace/tools";

/** Tool state or a saved row, turned into what the workspace shows (spec 2026-09-26-point-cloud-workspace §8.3, §8.5). */
export type ResultMap = Partial<Record<string, number | null>>;
export interface Live {
  results: ResultMap | null;
  refusal: string | null;
  warning: string | null;
}
export interface Headline {
  primary: string;
  secondary: string | null;
}

const NONE: Live = { results: null, refusal: null, warning: null };
/** S1's geographic refusal, single-sourced from `measure.ts` (M1 Ruling R3). */
export const DEGREES = NEEDS_PROJECTED_CRS;
/** One copy of the failed-profile fallback (M1 Ruling R13); reused by the Measurements tab and the profile panel. */
export const PROFILE_FAILED = "the profile could not be cut";
/** The hint bar's rings steps and section note (MeasureHint.tsx; here for react-refresh, as M1 Ruling R6). */
export const RING_STEPS = [
  "lower ring: three or more picks, then N",
  "upper ring: three or more picks, then Enter",
] as const;
export const SECTION_NOTE = "B takes A's height";

export function lineLength(a: MPoint, b: MPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function paramsOf(
  s: Pick<CloudToolState, "kind" | "mode" | "method" | "thicknessM">,
): CloudMeasurementParams | null {
  if (s.kind === "area") return { mode: s.mode };
  if (s.kind === "vertical") return { method: s.method };
  if (s.kind === "profile") return { thickness_m: s.thicknessM };
  return null;
}

/** The hint bar's live result: the same numbers and refusals the server will give (C-X1 mirrors C-B1). */
export function liveResult(s: CloudToolState, geographic: boolean): Live {
  if (!s.kind || !isComplete(s)) return NONE;
  if (s.kind !== "point" && geographic) return { ...NONE, refusal: DEGREES };
  if (s.kind === "profile") {
    const length = lineLength(s.picks[0], s.picks[1]);
    if (length < 0.1 || length > 2000)
      return {
        ...NONE,
        refusal: `a cross-section line must be 0.1 to 2 000 m long; this one is ${length.toFixed(2)} m`,
      };
    return { ...NONE, results: { profile_length_m: length } };
  }
  const kind: ComputableKind = s.kind;
  const params = paramsOf(s);
  if (kind === "area" || isRings(s)) {
    const why = measureRefusal(kind, s.picks, params);
    if (why) return { ...NONE, refusal: why.message };
  } else {
    const why = refusal(kind as MeasureKind, s.picks, geographic);
    if (why) return { ...NONE, refusal: why };
  }
  const r = measureResults(kind, s.picks, params);
  return {
    results: r,
    refusal: null,
    warning: kind === "area" && isNonCoplanar(r) ? NON_COPLANAR_NOTE : null,
  };
}

/** The POST body; `viewDir` (the camera direction at save) only orients an area's azimuth. */
export function createBody(s: CloudToolState, viewDir: readonly number[] | null): CloudMeasurementCreate {
  if (!s.kind) throw new Error("no measure tool is armed");
  const rings = isRings(s);
  const points = s.picks.map((p) => {
    const q = { x: p.x, y: p.y, z: p.z, uncertainty_m: p.uncertainty_m };
    return rings ? { ...q, group: p.group ?? 0 } : q;
  });
  const base = paramsOf(s);
  const params =
    s.kind === "area" && base
      ? { ...base, view_dir: viewDir ? [viewDir[0], viewDir[1], viewDir[2]] : null }
      : base;
  return params ? { kind: s.kind, points, params } : { kind: s.kind, points };
}

/** A saved row as tool state, so the same shapes draw it. */
export function stateOf(m: CloudMeasurement): CloudToolState {
  const p = m.params;
  return {
    ...INITIAL_TOOL,
    kind: m.kind,
    picks: m.points.map((q) => ({
      x: q.x,
      y: q.y,
      z: q.z,
      uncertainty_m: q.uncertainty_m,
      ...(q.group === 0 || q.group === 1 ? { group: q.group } : {}),
    })),
    closed: m.kind === "area",
    ring: 1,
    method: p?.method === "rings" ? "rings" : "points",
    mode: p?.mode === "plan" ? "plan" : "surface",
    thicknessM: p?.thickness_m ?? DEFAULT_THICKNESS_M,
  };
}

const xyz = (p: MPoint): XYZ => ({ x: p.x, y: p.y, z: p.z });

export function ringCircle(c: { x: number; y: number; z: number }, radius: number, n = 48): XYZ[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { x: c.x + radius * Math.cos(a), y: c.y + radius * Math.sin(a), z: c.z };
  });
}

function fitOrNull(points: readonly MPoint[]): RingFit | null {
  if (points.length < 3) return null;
  try {
    const f = fitRing(points);
    return Number.isFinite(f.radius_m) ? f : null;
  } catch (e) {
    if (e instanceof MeasureRefusal) return null;
    throw e;
  }
}

/** The 3D overlay of the armed tool (or of a saved row through `stateOf`). */
export function toolShapes(s: CloudToolState): OverlayShape[] {
  if (!s.kind) return [];
  if (s.kind === "area") {
    const shown = !s.closed && s.hover ? [...s.picks, s.hover] : s.picks;
    if (shown.length === 0) return [];
    const pts = shown.map(xyz);
    const out: OverlayShape[] = [{ kind: "points", points: pts, tone: "accent" }];
    if (pts.length >= 2) out.push({ kind: "line", points: pts, closed: s.closed, tone: "accent" });
    if (s.closed && pts.length >= 3) out.push({ kind: "polygon", points: pts, tone: "accent" });
    return out;
  }
  if (isRings(s)) {
    const out: OverlayShape[] = [];
    const centres: XYZ[] = [];
    for (const g of [0, 1] as const) {
      const ring = s.picks.filter((p) => (p.group ?? 0) === g);
      const tone = g === 0 ? "accent" : "ok";
      if (ring.length) out.push({ kind: "points", points: ring.map(xyz), tone });
      const fit = fitOrNull(ring);
      if (fit) {
        out.push({ kind: "line", points: ringCircle(fit, fit.radius_m), closed: true, tone });
        centres.push({ x: fit.x, y: fit.y, z: fit.z });
      }
    }
    if (centres.length === 2)
      out.push(
        { kind: "points", points: centres, tone: "warn" },
        { kind: "line", points: centres, tone: "warn" },
      );
    return out;
  }
  if (s.kind === "profile") {
    const a = s.picks[0];
    if (!a) return [];
    const b = s.picks[1] ?? (s.hover ? { ...s.hover, z: a.z } : null);
    const pts = b ? [xyz(a), xyz(b)] : [xyz(a)];
    const out: OverlayShape[] = [{ kind: "points", points: pts, tone: "accent" }];
    if (b) out.push({ kind: "line", points: pts, tone: "accent" });
    return out;
  }
  return overlayShapes(s.kind, s.picks, s.hover);
}

export function centroidOf(points: readonly { x: number; y: number; z: number }[]): MPoint {
  const n = points.length || 1;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  return { x: x / n, y: y / n, z: z / n, uncertainty_m: 0 };
}

/** Where the 3D label sits: the pick, the segment's middle, or the outline's / rings' centroid. */
export function labelAnchor(s: CloudToolState): MPoint | null {
  if (!s.kind || s.picks.length === 0) return null;
  if (s.kind === "point") return s.picks[0];
  if (s.kind === "area" || isRings(s)) return centroidOf(s.picks);
  return centroidOf(s.picks.slice(0, 2));
}

type N = number | null | undefined;
const len = (v: N) => (v == null ? "—" : formatLength(Math.abs(v)));
const signed = (v: N) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${formatLength(Math.abs(v))}`);
const sqm = (v: N) => (v == null ? "—" : `${v.toFixed(2)} m²`);
const deg = (v: N, d = 2) => (v == null ? "—" : `${v.toFixed(d)}°`);
const mm = (v: N) => (v == null ? "—" : `${Math.round(v * 1000)} mm`);
const plusMinus = (v: N) => (v == null ? "—" : `± ${formatLength(v)}`);

/** The label pill and the row's value: "12.840 m · Δz 11.020 m" (the mockup's `.mlabel`). */
export function headline(
  kind: CloudMeasurementKind,
  params: CloudMeasurementParams | null,
  r: ResultMap,
  points: readonly MPoint[],
): Headline {
  switch (kind) {
    case "point": {
      const p = points[0];
      return { primary: `Z ${p.z.toFixed(3)} m`, secondary: `E ${p.x.toFixed(3)} N ${p.y.toFixed(3)}` };
    }
    case "distance":
      return { primary: len(r.distance_3d), secondary: `Δz ${len(r.distance_vertical)}` };
    case "height":
      return { primary: signed(r.height_difference), secondary: `horizontal ${len(r.distance_horizontal)}` };
    case "vertical":
      return {
        primary: `${deg(r.lean_angle_deg)} · ${mm(r.lean_offset_m)}`,
        secondary: `${params?.method === "rings" ? "two rings" : "two points"} · towards ${deg(r.lean_azimuth_deg, 0)}`,
      };
    case "area":
      return params?.mode === "plan"
        ? { primary: sqm(r.area_m2), secondary: `surface ${sqm(r.area_surface_m2)}` }
        : { primary: sqm(r.area_m2), secondary: `plan ${sqm(r.area_plan_m2)}` };
    case "profile": {
      const length = r.profile_length_m ?? (points.length >= 2 ? lineLength(points[0], points[1]) : null);
      return {
        primary: len(length),
        secondary: `${(params?.thickness_m ?? DEFAULT_THICKNESS_M).toFixed(2)} m slab`,
      };
    }
  }
}

/** A Measurements-tab row: its value, and a subtitle that carries the profile's state. */
export function rowText(m: CloudMeasurement): { primary: string; subtitle: string } {
  const h = headline(m.kind, m.params, m.results, m.points);
  if (m.status === "computing") return { primary: h.primary, subtitle: "Cutting the profile…" };
  if (m.status === "failed") return { primary: h.primary, subtitle: m.error ?? PROFILE_FAILED };
  return { primary: h.primary, subtitle: [KIND_LABEL[m.kind], h.secondary].filter(Boolean).join(" · ") };
}

/** Every result of a saved measurement, with its uncertainty (spec §8.5 details). */
export function resultRows(m: CloudMeasurement): [string, string][] {
  const r = m.results;
  switch (m.kind) {
    case "point": {
      const p = m.points[0];
      return [
        ["E", p.x.toFixed(3)],
        ["N", p.y.toFixed(3)],
        ["Z", p.z.toFixed(3)],
        ["Uncertainty", plusMinus(r.uncertainty_m)],
      ];
    }
    case "distance":
      return [
        ["3D distance", len(r.distance_3d)],
        ["Horizontal", len(r.distance_horizontal)],
        ["Vertical", len(r.distance_vertical)],
        ["Uncertainty", plusMinus(r.uncertainty_m)],
      ];
    case "height":
      return [
        ["Height difference", signed(r.height_difference)],
        ["Horizontal", len(r.distance_horizontal)],
        ["Uncertainty", plusMinus(r.uncertainty_m)],
      ];
    case "vertical": {
      const rows: [string, string][] = [
        ["Lean", `${deg(r.lean_angle_deg, 3)} ± ${deg(r.angle_uncertainty_deg, 3)}`],
        ["Horizontal offset", len(r.lean_offset_m)],
        ["Lean direction", `${deg(r.lean_azimuth_deg, 1)} from grid north`],
        ["Lean ratio", r.lean_mm_per_m == null ? "—" : `${r.lean_mm_per_m.toFixed(1)} mm/m`],
        ["Height", len(r.distance_vertical)],
      ];
      if (m.params?.method === "rings")
        rows.push(
          ["Lower ring", `r ${len(r.ring_radius_lower_m)} · fit ${plusMinus(r.ring_rms_lower_m)}`],
          ["Upper ring", `r ${len(r.ring_radius_upper_m)} · fit ${plusMinus(r.ring_rms_upper_m)}`],
        );
      rows.push(["Uncertainty", plusMinus(r.uncertainty_m)]);
      return rows;
    }
    case "area":
      return [
        ["Surface area", sqm(r.area_surface_m2)],
        ["Plan area", sqm(r.area_plan_m2)],
        ["Perimeter", len(r.perimeter_m)],
        ["Tilt", `${deg(r.plane_tilt_deg, 1)} from horizontal`],
        ["Facing", r.plane_azimuth_deg == null ? "—" : `${deg(r.plane_azimuth_deg, 0)} from grid north`],
        ["Plane fit", plusMinus(r.plane_rms_m)],
        ["Uncertainty", r.uncertainty_m2 == null ? "—" : `± ${r.uncertainty_m2.toFixed(3)} m²`],
      ];
    case "profile":
      return [
        ["Length", len(r.profile_length_m ?? lineLength(m.points[0], m.points[1]))],
        ["Slab", `${(m.params?.thickness_m ?? DEFAULT_THICKNESS_M).toFixed(2)} m`],
        [
          "Z range",
          r.profile_z_min == null || r.profile_z_max == null
            ? "—"
            : `${r.profile_z_min.toFixed(2)} to ${r.profile_z_max.toFixed(2)} m`,
        ],
        ["Widest wall", len(r.profile_width_max_m)],
        ["Points", r.profile_point_count == null ? "—" : String(r.profile_point_count)],
      ];
  }
}

/** C-W1's palette tools that are measure tools, and the measurement kind each one saves. */
const TOOL_KIND: Partial<Record<CloudToolId, ToolKind>> = {
  point: "point",
  distance: "distance",
  height: "height",
  vertical: "vertical",
  area: "area",
  section: "profile",
};

export function measureKindOf(id: CloudToolId | null): ToolKind | null {
  return id ? (TOOL_KIND[id] ?? null) : null;
}
