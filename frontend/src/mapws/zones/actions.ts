import type { ApiClient } from "@contract/client";
import { messageOf } from "@/api/errors";
import { createSiteArea, deleteSiteArea, type SiteArea } from "@/api/siteAreas";
import { toWgs84, type Coord, type SiteFrame } from "@/mapws/annotations/bindings";
import { openRing } from "@/mapws/annotations/planar";
import type { ZoneCategory } from "./categories";
import { useZonesStore } from "./store";

export const ZONES_LOCAL = "Zones need a georeferenced site — this project uses local metres";
/** The site-area contract caps an outline at 1 000 points (Deviation 6). */
export const MAX_ZONE_VERTICES = 1000;

/** A refusal decided on the client (toasted as info, W3-16); nothing is sent. */
export class ZoneRefusal extends Error {}

const round8 = (v: number) => Math.round(v * 1e8) / 1e8;

/** W3-3: site frame → WGS84 through W1's `toWgs84(frame)`; null (a local frame) is refused. */
export function siteRingToWgs84(
  ring: readonly number[][],
  convert: ((c: Coord) => Coord) | null,
): [number, number][] {
  if (!convert) throw new ZoneRefusal(ZONES_LOCAL);
  const open = openRing(ring);
  if (open.length < 3) throw new ZoneRefusal("A zone needs at least three corners.");
  if (open.length > MAX_ZONE_VERTICES)
    throw new ZoneRefusal(`A zone can have at most ${MAX_ZONE_VERTICES} corners.`);
  const out = open.map((c) => {
    const [lon, lat] = convert([c[0], c[1]]);
    return [round8(lon), round8(lat)] as [number, number];
  });
  const onGlobe = out.every(
    ([lon, lat]) =>
      Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90,
  );
  if (!onGlobe) throw new ZoneRefusal("The zone could not be placed on the globe.");
  return out;
}

/** The Z tool's `disabledReason` (spec §14). */
export function zoneToolUnavailable(ctx: { frame: SiteFrame }): string | null {
  return ctx.frame.kind === "local" ? ZONES_LOCAL : null;
}

/**
 * Spec §9.4: the Z tool posts a SiteArea; the server starts the existing `area_recount` job. A
 * refusal (local frame, too few or too many corners) rejects before anything is sent.
 */
export async function createZone(
  api: ApiClient,
  projectId: string,
  input: { name: string; category: ZoneCategory; ring: readonly number[][]; frame: SiteFrame },
): Promise<SiteArea> {
  const polygon_wgs84 = siteRingToWgs84(input.ring, toWgs84(input.frame));
  return createSiteArea(api, projectId, { name: input.name, category: input.category, polygon_wgs84 });
}

/** The toast text: a refusal's own copy, else the server's message (M-W3 P8: no M-B5 branch). */
export function zoneFailure(e: unknown): string {
  if (e instanceof ZoneRefusal) return e.message;
  return messageOf(e, "could not save the zone");
}

/** The inspector's Delete and W1's `Del`: delete (the server recounts), then drop it from the layer. */
export async function removeZone(api: ApiClient, projectId: string, id: string): Promise<void> {
  await deleteSiteArea(api, projectId, id);
  useZonesStore.getState().remove(id);
}
