import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";
import type { FindingDetail } from "./findings";

type S = components["schemas"];
const P = "/api/v1/projects/{projectId}" as const;

export type AnchorConvert = S["AnchorConvertRequest"];
export type AnchorConverted = S["AnchorConverted"];
export type MapFindingPin = S["MapFindingPin"];
export type MapFindingsInView = S["MapFindingsInView"];
/** W1 owns the actual call (`mapws/readout/sampleApi.ts`), re-exported through `annotations/bindings.ts`. */
export type FrameSample = S["FrameSample"];
export type FindingCreate = S["FindingCreate"];

/** Site-frame geometry → the map's CRS plus its WGS84 centroid, for F's create (spec §9.4). */
export function convertAnchor(
  api: ApiClient,
  projectId: string,
  body: AnchorConvert,
): Promise<AnchorConverted> {
  return unwrap(
    api.POST(`${P}/map-workspace/anchor`, {
      params: { path: { projectId } },
      body,
    }),
  );
}

/** `bbox` is `minx,miny,maxx,maxy` in the site frame; no `map_ids` means every survey. ≤ 5 000 pins. */
export function listMapFindingsInView(
  api: ApiClient,
  projectId: string,
  query: { bbox: string; map_ids?: string[] },
  signal?: AbortSignal,
): Promise<MapFindingsInView> {
  return unwrap(
    api.GET(`${P}/map-workspace/findings`, {
      params: { path: { projectId }, query: { ...query, frame: "site" } },
      signal,
    }),
  );
}

/** F's `createFinding` (201 FindingDetail); no wrapper for this exists in `api/findings.ts` (M-W3 deviation 2). */
export function createFinding(
  api: ApiClient,
  projectId: string,
  body: FindingCreate,
): Promise<FindingDetail> {
  return unwrap(api.POST(`${P}/findings`, { params: { path: { projectId } }, body }));
}
