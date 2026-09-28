import type { ApiClient } from "@contract/client";
import { unwrap } from "./errors";
import {
  listFindings,
  patchFinding,
  type Finding,
  type FindingDetail,
  type FindingListQuery,
} from "./findings";

const P = "/api/v1/projects/{projectId}" as const;

/** Pins drawn per cloud (spec §9.2); F's findings page maximum. */
export const PIN_CAP = 500;
/** Extra pages read only to count the findings beyond the cap (plan Ruling 6). */
export const PIN_COUNT_PAGES = 10;

export interface CloudAnchorInput {
  cloud_id: string;
  x: number;
  y: number;
  z: number;
  uncertainty_m: number | null;
}

export interface PinPage {
  items: Finding[];
  total: number;
  /** True when counting stopped early: the real total is at least `total`. */
  totalIsFloor: boolean;
}

/** F's `POST /findings` with a cloud anchor and nothing else in it (spec C10). */
export function createCloudFinding(
  api: ApiClient,
  projectId: string,
  body: { type_id: string; anchor: CloudAnchorInput; severity: number | null; note: string },
): Promise<FindingDetail> {
  const a = body.anchor;
  return unwrap(
    api.POST(`${P}/findings`, {
      params: { path: { projectId } },
      body: {
        type_id: body.type_id,
        anchor: {
          kind: "cloud",
          cloud_id: a.cloud_id,
          x: a.x,
          y: a.y,
          z: a.z,
          uncertainty_m: a.uncertainty_m,
        },
        severity: body.severity,
        note: body.note,
      },
    }),
  );
}

/** Move pin: F's `PATCH` with `anchor.x/y/z/uncertainty_m` (F's `FindingAnchorPatch` for clouds). */
export function moveCloudFinding(
  api: ApiClient,
  projectId: string,
  findingId: string,
  p: { x: number; y: number; z: number; uncertainty_m: number | null },
): Promise<FindingDetail> {
  return patchFinding(api, projectId, findingId, {
    anchor: { x: p.x, y: p.y, z: p.z, uncertainty_m: p.uncertainty_m },
  });
}

/**
 * The cloud's findings, highest severity first, capped at 500; counts the rest in ≤ 10 pages.
 * `stopped` is checked before each counting page: a superseded load stops its walk (the partial
 * page it returns is discarded by the caller).
 */
export async function listCloudPins(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  stopped: () => boolean = () => false,
): Promise<PinPage> {
  const query: FindingListQuery = {
    anchor_kind: ["cloud"],
    data_id: cloudId,
    sort: "-severity",
    limit: PIN_CAP,
  };
  const first = await listFindings(api, projectId, query);
  let total = first.items.length;
  let cursor = first.next_cursor;
  for (let i = 0; i < PIN_COUNT_PAGES && cursor; i++) {
    if (stopped()) break;
    const page = await listFindings(api, projectId, { ...query, cursor });
    total += page.items.length;
    cursor = page.next_cursor === cursor ? null : page.next_cursor;
  }
  return { items: first.items, total, totalIsFloor: cursor !== null };
}

const count = new Intl.NumberFormat("en-GB");

export function pinCapNote(page: Pick<PinPage, "items" | "total" | "totalIsFloor">): string | null {
  if (page.total <= page.items.length && !page.totalIsFloor) return null;
  return `${count.format(page.items.length)} of ${count.format(page.total)}${page.totalIsFloor ? "+" : ""} pins shown`;
}
