import proj4 from "proj4";
import type { GeoMap } from "@contract/client";
import type { Finding } from "@/api/findings";
import { parseAt as parseAtXY } from "@/clouds/jump";
import { findingHref } from "@/findings/links";
import { evaluateHref } from "../links";
import type { Coord, Selection, SiteFrame } from "../types";
import { fromWgs84 } from "../view/siteFrame";

/** Query params that ask the workspace to go somewhere once; removed after arriving (R-W1-6). */
export const ARRIVAL_PARAMS = ["finding", "map", "at", "tool"] as const;
/** R-W1-8: about 60 m across a 1200 px stage. */
export const ARRIVAL_RESOLUTION = 0.05;

export const LOCAL_FINDING_NOTICE =
  "Findings need a map with coordinates, so this one is not shown on the map.";
export const NO_LOCATION_NOTICE = "This finding has no location on the map yet.";

export type ArrivalRequest =
  | { kind: "none" }
  | { kind: "finding"; findingId: string; mapId: string | null }
  | { kind: "map"; mapId: string; at: Coord | null }
  | { kind: "tool"; toolId: string };

/**
 * `?at=x,y` in the destination's native CRS. D2: reuses clouds/jump.ts's `parseAt` (the same
 * `URLSearchParams` shape and number parsing as the clouds jump), adapted from its `{x, y}` to a
 * `Coord` tuple.
 */
export function parseAt(p: URLSearchParams): Coord | null {
  const xy = parseAtXY(p);
  return xy ? [xy.x, xy.y] : null;
}

/** An arrival that asks to centre somewhere (a finding, or a map with `at`): the site fit waits for it. */
export const asksToCentre = (req: ArrivalRequest): boolean =>
  req.kind === "finding" || (req.kind === "map" && req.at !== null);

export function arrivalRequest(p: URLSearchParams): ArrivalRequest {
  const finding = p.get("finding");
  const map = p.get("map");
  if (finding) return { kind: "finding", findingId: finding, mapId: map };
  if (map) return { kind: "map", mapId: map, at: parseAt(p) };
  const tool = p.get("tool");
  if (tool) return { kind: "tool", toolId: tool };
  return { kind: "none" };
}

export function stripArrival(p: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(p);
  for (const k of ARRIVAL_PARAMS) next.delete(k);
  return next;
}

/** R-W1-7: a map's survey date is its capture date, else its import date. */
export function mapSurveyDate(m: Pick<GeoMap, "captured_on" | "created_at">): string {
  return m.captured_on ?? m.created_at.slice(0, 10);
}

export type ArrivalPlan =
  | { kind: "navigate"; to: string }
  | {
      kind: "arrive";
      r: string | null;
      centre: Coord | null;
      resolution: number | null;
      selection: Selection | null;
      notice: string | null;
    };

/**
 * F §8.7's `maps?map=<mapId>&finding=<fid>`: equivalent to `sel=finding:<fid>` with that map's date as r;
 * the view centres on the anchor and the inspector opens. A finding on another map (or not on a map)
 * goes to its own place through F's one link builder.
 */
export function planFindingArrival(a: {
  projectId: string;
  requestedMapId: string | null;
  finding: Pick<Finding, "id" | "anchor" | "lon" | "lat">;
  anchorMap: Pick<GeoMap, "captured_on" | "created_at"> | null;
  frame: SiteFrame;
}): ArrivalPlan {
  const { finding, frame } = a;
  const anchor = finding.anchor;
  if (anchor.kind !== "map" || (a.requestedMapId !== null && anchor.map_id !== a.requestedMapId))
    return { kind: "navigate", to: findingHref(a.projectId, finding) };
  const r = a.anchorMap ? mapSurveyDate(a.anchorMap) : null;
  const selection: Selection = { kind: "finding", id: finding.id };
  const stay = {
    kind: "arrive" as const,
    r,
    centre: null,
    resolution: null,
    selection,
  };
  if (frame.kind === "local") return { ...stay, notice: LOCAL_FINDING_NOTICE };
  const convert = fromWgs84(frame);
  if (!convert || finding.lon === null || finding.lat === null)
    return { ...stay, notice: NO_LOCATION_NOTICE };
  return {
    ...stay,
    centre: convert([finding.lon, finding.lat]),
    resolution: ARRIVAL_RESOLUTION,
    notice: null,
  };
}

/**
 * `maps?map=<id>[&at=x,y]`: that map's date as r, and the point (in the map's native CRS) centred.
 * A map with no coordinates is not in the workspace; it goes to its evaluation screen (spec §14).
 */
export function planMapArrival(a: {
  projectId: string;
  map: Pick<GeoMap, "id" | "captured_on" | "created_at" | "crs_wkt" | "proj4">;
  at: Coord | null;
  frame: SiteFrame;
}): ArrivalPlan {
  if (!a.map.crs_wkt) return { kind: "navigate", to: evaluateHref(a.projectId, a.map.id) };
  const r = mapSurveyDate(a.map);
  const stay = {
    kind: "arrive" as const,
    r,
    centre: null,
    resolution: null,
    selection: null,
    notice: null,
  };
  if (!a.at || a.frame.kind !== "crs" || !a.frame.proj4 || !a.map.proj4) return stay;
  const centre = proj4(a.map.proj4, a.frame.proj4).forward(a.at) as Coord;
  return { ...stay, centre, resolution: ARRIVAL_RESOLUTION };
}
