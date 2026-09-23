import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type OlMap from "ol/Map";
import type { GeoMap } from "@contract/client";
import { useApi } from "@/api/client";
import { listSiteAreas, type SiteArea } from "@/api/siteAreas";
import { useSiteAreaLayer } from "@/maps/siteAreaLayer";
import { toast } from "@/ui";

/** `?draw=site-area` on a map opens the viewer with the site-area outline tool. */
export const DRAW_PARAM = "draw";
export const DRAW_SITE_AREA = "site-area";

/**
 * The map viewer's site areas: loads them (detection projects only), draws them on the map and,
 * while `?draw=site-area` is set, runs the outline tool. Returns what the draw strip needs.
 */
export function useSiteAreaOverlay(
  olMap: OlMap | null,
  geoMap: GeoMap | null,
  projectId: string,
  enabled: boolean,
) {
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [areas, setAreas] = useState<SiteArea[]>([]);
  const [polygon, setPolygon] = useState<number[][] | null>(null);
  const drawMode = enabled && params.get(DRAW_PARAM) === DRAW_SITE_AREA;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // The outlines are context on the map; if they cannot load, the map still works without them.
    listSiteAreas(api, projectId)
      .then((a) => {
        if (!cancelled) setAreas(a);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, projectId, enabled]);

  useSiteAreaLayer(olMap, enabled ? geoMap : null, {
    areas,
    drawing: drawMode && polygon === null,
    onDrawn: setPolygon,
  });

  const cancel = useCallback(() => {
    setPolygon(null);
    const next = new URLSearchParams(params);
    next.delete(DRAW_PARAM);
    setParams(next, { replace: true });
  }, [params, setParams]);

  const saved = useCallback(
    (area: SiteArea) => {
      setPolygon(null);
      toast("ok", `Site area ${area.name} saved. Its counts are being worked out for every map.`);
      navigate(`/p/${projectId}/site-areas`);
    },
    [navigate, projectId],
  );

  return { drawMode: drawMode && geoMap !== null, polygon, cancel, saved };
}
