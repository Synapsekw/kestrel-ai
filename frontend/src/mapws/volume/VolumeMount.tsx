import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Collection from "ol/Collection";
import type Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import { boundingExtent } from "ol/extent";
import type Polygon from "ol/geom/Polygon";
import Modify from "ol/interaction/Modify";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import TileImage from "ol/source/TileImage";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style } from "ol/style";
import type { Surface, VolumeMeasurement } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listSurfaces } from "@/api/surfaces";
import { fetchFootprintsSite, fetchVolumeSite, listVolumes } from "@/api/volumes";
import { pushLog } from "@/app/diagnostics";
import { tokenColour } from "@/maps/styles";
import {
  fillTile,
  makeSiteTileLoader,
  siteTileGrid,
  useMapPane,
  useTools,
  useWorkspace,
  type LayerMountProps,
} from "@/mapws/w4host";
import { useChangesStore } from "@/store/changes";
import { toast } from "@/ui";
import { saveVolume } from "./saveVolume";
import { maskFeatures, openRing, volumeFeature } from "./volumeFeatures";
import { heatmapTileUrl, MAX_VOLUMES_DRAWN, sameFrame } from "./volumeModel";
import { useVolumeStore } from "./volumeStore";

/** Footprints drawn for the selected measurement (plan budget; the server truncates past this too). */
const MAX_FOOTPRINTS = 5000;
const NO_RINGS: number[][][] = [];

function styleOf(f: FeatureLike): Style {
  const role = f.get("role");
  if (role === "footprint")
    return new Style({
      stroke: new Stroke({ color: tokenColour("warn"), width: 1.5 }),
      fill: new Fill({ color: tokenColour("warn", 0.12) }),
    });
  if (role === "exclusion") {
    const exclude = f.get("mode") === "exclude";
    return new Style({
      stroke: new Stroke({ color: tokenColour("danger"), width: 2, lineDash: exclude ? undefined : [8, 5] }),
      fill: new Fill({ color: tokenColour("danger", exclude ? 0.22 : 0.06) }),
    });
  }
  if (role === "stable")
    return new Style({
      stroke: new Stroke({ color: tokenColour("ok"), width: 2, lineDash: [10, 6] }),
      fill: new Fill({ color: tokenColour("ok", 0.08) }),
    });
  const selected = f.get("selected") === true;
  return new Style({
    stroke: new Stroke({ color: tokenColour("accent"), width: selected ? 3 : 2 }),
    fill: new Fill({ color: tokenColour("accent", selected ? 0.1 : 0.04) }),
  });
}

interface Drawn {
  m: VolumeMeasurement;
  ring: number[][];
}

/**
 * The Volumes row on one ol/Map (spec §10): every measurement's polygon (≤ 200, newest first), the
 * selected one's masks, footprints and heatmap, and vertex editing. Masks are drawn through W1's
 * drawing pipeline (the "volume" tool, ruling T8-2), not here. Layers are built only when their
 * source changes; z and opacity are property updates (RasterMount pattern, ruling T8-3).
 */
export function VolumeMount({ map, zIndex, opacity, projectId, frame }: LayerMountProps) {
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const pane = useMapPane();
  const editor = pane.side !== "left"; // one pane edits; Side-by-side mounts this on both maps
  const selection = useWorkspace((s) => s.selection);
  const selectedId = selection?.kind === "volume" ? selection.id : null;
  const activeTool = useTools((s) => s.active);
  const volumesRevision = useChangesStore((s) => s.volumesRevision);
  const surfacesRevision = useChangesStore((s) => s.surfacesRevision);
  const findingsRevision = useChangesStore((s) => s.findingsRevision);
  const heatmap = useVolumeStore((s) => s.heatmap);
  const drawing = useVolumeStore((s) => s.drawing);
  const autoRecalc = useVolumeStore((s) => s.autoRecalc);
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [drawn, setDrawn] = useState<Drawn[]>([]);
  const [loadedFootprints, setFootprints] = useState<{ id: string; rings: number[][][] } | null>(null);
  const [reloads, setReloads] = useState(0);
  const reloadVolumes = useCallback(() => setReloads((n) => n + 1), []);
  const source = useMemo(() => new VectorSource(), []);
  const masks = useMemo(() => new VectorSource(), []);
  const current = drawn.find((x) => x.m.id === selectedId) ?? null;
  const selected = current?.m ?? null;
  const top = selected ? (surfaces.find((s) => s.id === selected.top_surface_id) ?? null) : null;
  const identity = !!top && sameFrame(frame, top);

  // The polygons in site coordinates: native when the top is in the site CRS, else ?frame=site.
  useEffect(() => {
    let cancelled = false;
    Promise.all([listSurfaces(api, projectId), listVolumes(api, projectId)])
      .then(async ([all, vols]) => {
        const newest = [...vols]
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, MAX_VOLUMES_DRAWN);
        const byId = new Map(all.map((s) => [s.id, s]));
        const out = await Promise.all(
          newest.map(async (m): Promise<Drawn | null> => {
            const t = byId.get(m.top_surface_id);
            if (t && sameFrame(frame, t)) return { m, ring: m.polygon_native };
            const site = await fetchVolumeSite(api, projectId, m.id);
            return site.polygon_site ? { m, ring: site.polygon_site } : null;
          }),
        );
        if (cancelled) return;
        setSurfaces(all);
        setDrawn(out.filter((x): x is Drawn => x !== null));
      })
      .catch((err: unknown) => {
        if (!cancelled) pushLog(`volumes layer: ${messageOf(err, "could not load the volumes")}`);
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, frame, volumesRevision, surfacesRevision, reloads]);

  // The selected measurement's machine footprints; a finding change can drop one (M-B5 hand-off).
  const footprintKey = selected && selected.masks.detection_run_ids.length > 0 ? selected.id : null;
  const selectedMasks = selected?.masks;
  useEffect(() => {
    if (!footprintKey) return;
    let cancelled = false;
    fetchFootprintsSite(api, projectId, footprintKey)
      .then((f) => {
        if (cancelled) return;
        setFootprints({
          id: footprintKey,
          rings: f.items
            .slice(0, MAX_FOOTPRINTS)
            .map((i) => i.ring_site)
            .filter((r): r is number[][] => !!r),
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFootprints(null);
        pushLog(`volumes layer: ${messageOf(err, "could not load the footprints")}`);
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, footprintKey, selectedMasks, findingsRevision]);
  const footprints =
    loadedFootprints && loadedFootprints.id === footprintKey ? loadedFootprints.rings : NO_RINGS;

  // Built once per map; z and opacity below are property updates.
  const polysRef = useRef<VectorLayer | null>(null);
  const masksRef = useRef<VectorLayer | null>(null);
  useEffect(() => {
    const polys = new VectorLayer({ source, style: styleOf });
    const maskLayer = new VectorLayer({ source: masks, style: styleOf });
    polysRef.current = polys;
    masksRef.current = maskLayer;
    map.addLayer(maskLayer);
    map.addLayer(polys);
    return () => {
      map.removeLayer(polys);
      map.removeLayer(maskLayer);
      polys.dispose();
      maskLayer.dispose();
      if (polysRef.current === polys) polysRef.current = null;
      if (masksRef.current === maskLayer) masksRef.current = null;
    };
  }, [map, source, masks]);
  useEffect(() => {
    polysRef.current?.setZIndex(zIndex);
    masksRef.current?.setZIndex(zIndex);
  }, [zIndex, map, source, masks]);
  useEffect(() => {
    polysRef.current?.setOpacity(opacity);
    masksRef.current?.setOpacity(opacity);
  }, [opacity, map, source, masks]);

  useEffect(() => {
    source.clear();
    source.addFeatures(drawn.map(({ m, ring }) => volumeFeature(m.id, ring, m.id === selectedId)));
  }, [source, drawn, selectedId]);
  useEffect(() => {
    masks.clear();
    if (selected) masks.addFeatures(maskFeatures(selected, footprints, identity));
  }, [masks, selected, footprints, identity]);

  const ctx = useRef({ api, projectId, autoRecalc });
  useEffect(() => {
    ctx.current = { api, projectId, autoRecalc };
  });

  // Vertex edit of the selected polygon only (ruling T8-5), always written as polygon_site (the server converts).
  const editable = !!selectedId && editor && !drawing && activeTool === "select";
  useEffect(() => {
    if (!editable || !selectedId) return;
    const feature = source.getFeatureById(selectedId) as Feature | null;
    if (!feature) return;
    const modify = new Modify({ features: new Collection([feature]) });
    modify.on("modifyend", () => {
      const ring = openRing((feature.getGeometry() as Polygon).getCoordinates()[0]);
      const { api: a, projectId: p, autoRecalc: auto } = ctx.current;
      saveVolume(a, p, selectedId, { polygon_site: ring }, auto).catch((err: unknown) =>
        toast("danger", messageOf(err, "could not save the polygon")),
      );
    });
    map.addInteraction(modify);
    return () => {
      map.removeInteraction(modify);
      modify.dispose();
    };
  }, [map, source, selectedId, editable, drawn]);

  // Heatmap: the volume_diff site tiles of the selected, calculated measurement, clamped to its ring.
  const heatUrl =
    selected?.results && heatmap
      ? heatmapTileUrl(baseUrl, token, projectId, selected.id, selected.results.computed_at)
      : null;
  const extentKey = current && heatUrl ? JSON.stringify(boundingExtent(current.ring)) : null;
  const heatRef = useRef<TileLayer<TileImage> | null>(null);
  useEffect(() => {
    if (!heatUrl || !extentKey) return;
    let reread = false; // every gone tile reports it; one re-read per layer is enough
    const layer = new TileLayer({
      extent: JSON.parse(extentKey) as number[],
      preload: 0,
      source: new TileImage({
        projection: map.getView().getProjection(),
        tileGrid: siteTileGrid(),
        transition: 0,
        tileUrlFunction: (c) => (c ? fillTile(heatUrl, c) : undefined),
        // 204 → empty tile; 404/410 → the measurement is gone: re-read the list (not markGone, T8-4).
        tileLoadFunction: makeSiteTileLoader(() => {
          if (reread) return;
          reread = true;
          reloadVolumes();
        }),
      }),
    });
    heatRef.current = layer;
    map.addLayer(layer);
    return () => {
      map.removeLayer(layer);
      layer.dispose();
      if (heatRef.current === layer) heatRef.current = null;
    };
  }, [map, heatUrl, extentKey, reloadVolumes]);
  useEffect(() => {
    heatRef.current?.setZIndex(zIndex - 1);
  }, [zIndex, map, heatUrl, extentKey, reloadVolumes]);
  useEffect(() => {
    heatRef.current?.setOpacity(opacity);
  }, [opacity, map, heatUrl, extentKey, reloadVolumes]);

  return null;
}
