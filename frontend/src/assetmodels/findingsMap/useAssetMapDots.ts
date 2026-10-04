import { useEffect, useState } from "react";
import type { ApiClient } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listFindings, type Finding } from "@/api/findings";
import { useChangesStore } from "@/store/changes";
import type { MapDot } from "./geometry";

/** A map dot plus the facts the tip and the opener read. */
export type FindingMapDot = MapDot & {
  number: number;
  side: string | null;
  zone: string | null;
  height_m: number;
};

/** The API's findings page cap. */
export const MAP_DOTS_PAGE = 500;
/** Budget: the map draws at most this many dots; the card says when it stops. */
export const MAP_DOTS_MAX = 4000;
const MAX_PAGES = MAP_DOTS_MAX / MAP_DOTS_PAGE;

/** A placed finding's map facts; null without a height (unplaced: no zone, side or height). */
export function toMapDot(f: Finding): FindingMapDot | null {
  if (f.height_m === null) return null;
  return {
    id: f.id,
    number: f.number,
    severity: f.severity,
    height_m: f.height_m,
    bearing_deg: f.bearing_deg,
    side: f.side,
    zone: f.zone,
  };
}

/** This model's placed findings that are not closed, keyset-paged, highest severity first. */
export async function fetchMapDots(
  api: ApiClient,
  projectId: string,
  modelId: string,
): Promise<{ dots: FindingMapDot[]; truncated: boolean }> {
  const dots: FindingMapDot[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await listFindings(api, projectId, {
      asset_model_id: modelId,
      placed: true,
      status: ["open", "reviewed"],
      sort: "-severity",
      limit: MAP_DOTS_PAGE,
      ...(cursor ? { cursor } : {}),
    });
    for (const f of res.items) {
      const d = toMapDot(f);
      if (d) dots.push(d);
    }
    // A repeated cursor (the Prism mock) ends paging instead of looping.
    if (!res.next_cursor || res.next_cursor === cursor) return { dots, truncated: false };
    cursor = res.next_cursor;
  }
  return { dots: dots.slice(0, MAP_DOTS_MAX), truncated: true };
}

interface Loaded {
  base: string;
  dots: FindingMapDot[] | null;
  truncated: boolean;
  error: string | null;
}

/** The map's dots; re-read on `findings.changed`, keeping the last dots on screen meanwhile. */
export function useAssetMapDots(projectId: string, modelId: string) {
  const api = useApi();
  const revision = useChangesStore((s) => s.findingsRevision);
  const base = `${projectId}|${modelId}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let live = true;
    fetchMapDots(api, projectId, modelId).then(
      (r) => {
        if (live) setLoaded({ base, dots: r.dots, truncated: r.truncated, error: null });
      },
      (e: unknown) => {
        if (live)
          setLoaded((prev) => ({
            base,
            dots: prev?.base === base ? prev.dots : null,
            truncated: false,
            error: messageOf(e, "could not load the findings map"),
          }));
      },
    );
    return () => {
      live = false;
    };
  }, [api, projectId, modelId, base, revision]);
  const current = loaded?.base === base ? loaded : null;
  return {
    dots: current?.dots ?? null,
    truncated: current?.truncated ?? false,
    error: current?.error ?? null,
  };
}
