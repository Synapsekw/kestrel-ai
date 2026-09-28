import type { ApiClient } from "@contract/client";
import { codeOf, isNotImplemented, messageOf } from "@/api/errors";
import type { FindingDetail } from "@/api/findings";
import { convertAnchor, createFinding, type AnchorConvert } from "@/api/mapFindings";
import type { SiteFrame } from "@/mapws/annotations/bindings";
import { hasOrtho, pickAnchorMap, type PickLayer, type Shown } from "@/mapws/annotations/pick";
import { centroid, closeRing, dedupe, openRing } from "@/mapws/annotations/planar";

export const NO_ORTHO = "Findings need an orthomosaic under them";
export const FINDINGS_LOCAL = "Findings need a georeferenced site — this project uses local metres";
/** A finding outline follows the site-area cap (Deviation 6). */
export const MAX_FINDING_VERTICES = 1000;

export type FindingShape = "point" | "polygon";

/** A refusal decided on the client (toasted as info, W3-16). */
export class FindingRefusal extends Error {}

/** The server's 422 domain refusals that carry the spec's refusal copy (W3-5, M-W3 P11/T5a). */
const SERVER_REFUSALS: Record<string, string> = {
  no_coordinates: NO_ORTHO,
  outside_map: NO_ORTHO,
  local_frame: FINDINGS_LOCAL,
};

export function siteGeometry(
  shape: FindingShape,
  coords: readonly number[][],
): AnchorConvert["geometry_site"] {
  const pts = dedupe(coords);
  if (shape === "point") {
    if (pts.length === 0) throw new FindingRefusal("Click once to place the finding.");
    return { type: "Point", coordinates: [pts[0][0], pts[0][1]] };
  }
  const ring = openRing(pts);
  if (ring.length < 3) throw new FindingRefusal("A finding outline needs at least three corners.");
  if (ring.length > MAX_FINDING_VERTICES)
    throw new FindingRefusal(`A finding outline can have at most ${MAX_FINDING_VERTICES} corners.`);
  return { type: "Polygon", coordinates: [closeRing(ring)] };
}

export function anchorPoint(shape: FindingShape, coords: readonly number[][]): [number, number] {
  return shape === "point" ? [coords[0][0], coords[0][1]] : centroid(coords);
}

/** W3-5: the ortho the finding is anchored on, or why there is none. */
export function anchorMapFor(
  layers: readonly PickLayer[],
  shown: Shown,
  rDate: string | null,
  shape: FindingShape,
  coords: readonly number[][],
): { mapId: string } | { refusal: string } {
  const m = pickAnchorMap(layers, shown, rDate, anchorPoint(shape, coords));
  return m ? { mapId: m.id } : { refusal: NO_ORTHO };
}

/** The M and G tools' `disabledReason` (spec §14). */
export function findingToolUnavailable(ctx: {
  frame: SiteFrame;
  layers: readonly PickLayer[];
  /** The session's gone keys (M-W3 P4); W1's ToolContext has none, so the tool files pass them. */
  gone?: ReadonlySet<string>;
}): string | null {
  if (ctx.frame.kind === "local") return FINDINGS_LOCAL;
  if (!hasOrtho(ctx.layers, ctx.gone)) return "Findings need an orthomosaic — import one";
  return null;
}

/** Spec §9.4: site geometry → `convertAnchor` → F's `createFinding` with a map anchor. */
export async function createMapFinding(
  api: ApiClient,
  projectId: string,
  input: {
    shape: FindingShape;
    coords: readonly number[][];
    mapId: string;
    typeId: string;
  },
): Promise<FindingDetail> {
  const converted = await convertAnchor(api, projectId, {
    map_id: input.mapId,
    geometry_site: siteGeometry(input.shape, input.coords),
  });
  return createFinding(api, projectId, {
    type_id: input.typeId,
    anchor: { kind: "map", map_id: input.mapId, geometry: converted.geometry },
    lon: converted.lon,
    lat: converted.lat,
  });
}

/** A refusal (client or server) toasts `info`; anything else is a failure and toasts `danger` (W3-16). */
export function isFindingRefusal(e: unknown): boolean {
  if (e instanceof FindingRefusal) return true;
  const code = codeOf(e);
  return code !== null && code in SERVER_REFUSALS;
}

export function findingFailure(e: unknown): string {
  if (isNotImplemented(e)) return "Map findings need the map workspace backend (M-B1)";
  const code = codeOf(e);
  if (code !== null && code in SERVER_REFUSALS) return SERVER_REFUSALS[code];
  return messageOf(e, "could not add the finding");
}
