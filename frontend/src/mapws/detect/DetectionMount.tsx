import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import type OlMap from "ol/Map";
import { getCenter } from "ol/extent";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import { bbox as bboxStrategy } from "ol/loadingstrategy";
import VectorSource from "ol/source/Vector";
import { Circle, Fill, Stroke, Style, Text } from "ol/style";
import RegularShape from "ol/style/RegularShape";
import type { ClassDef, MapRun } from "@contract/client";
import { pushLog } from "@/app/diagnostics";
import { useApi } from "@/api/client";
import { listMapRuns } from "@/api/maps";
import { fetchSiteDensity, fetchSiteDetections, siteBbox } from "@/api/mapDetect";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { MIN_SCREEN_PX, markFor } from "@/maps/detectionMark";
import { tokenColour, withAlpha } from "@/maps/styles";
import {
  SELECTION_PROP,
  attachSwipeClip,
  type ClipLayer,
  type LayerMountProps,
  useMapPane,
  useWorkspace,
  useWorkspaceStores,
} from "@/mapws/w4host";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";
import {
  detectionSelection,
  lookOf,
  parseDetectionId,
  shownRuns,
  sideDates,
  surveyMaps,
} from "./detectModel";
import { lookStyle, tagText, type LookStyle } from "./detectionStyle";
import { useDetectStore } from "./detectStore";

const paint = (c: string, alpha = 1) =>
  c.startsWith("token:") ? tokenColour(c.slice(6), alpha) : withAlpha(c, alpha);

function olStyle(ls: LookStyle, f: FeatureLike, resolution: number, tag: string): Style {
  const stroke = new Stroke({
    color: paint(ls.stroke),
    width: ls.width,
    lineDash: ls.dash ?? undefined,
  });
  const fill = new Fill({ color: paint(ls.fill, ls.fillAlpha) });
  const e = f.getGeometry()?.getExtent();
  const mark = e ? markFor(e[2] - e[0], e[3] - e[1], resolution) : "box";
  if (mark === "clamped" && e)
    return new Style({
      geometry: new Point(getCenter(e)),
      image: new RegularShape({
        points: 4,
        angle: Math.PI / 4,
        radius: (MIN_SCREEN_PX / 2) * Math.SQRT2,
        fill,
        stroke,
        declutterMode: "none",
      }),
    });
  return new Style({
    stroke,
    fill,
    text:
      mark === "labelled" && ls.label
        ? new Text({
            text: tag,
            font: '12px "Space Grotesk Variable", system-ui, sans-serif',
            fill: new Fill({ color: tokenColour("ink") }),
            stroke: new Stroke({ color: tokenColour("tip", 0.8), width: 3 }),
            overflow: true,
          })
        : undefined,
  });
}

/** One run's boxes (bbox-loaded, site frame) or its density dots when the view holds > 5 000. */
function RunLayer({
  map,
  projectId,
  run,
  date,
  types,
  opacity,
  zIndex,
  selectedId,
}: {
  map: OlMap;
  projectId: string;
  run: MapRun;
  date: string;
  types: ReadonlyMap<string, ClassDef>;
  opacity: number;
  zIndex: number;
  selectedId: string | null;
}) {
  const api = useApi();
  const { workspace } = useWorkspaceStores();
  const mode = useWorkspace((s) => s.mode);
  const l = useWorkspace((s) => s.l);
  const typesRef = useRef(types);
  const selRef = useRef(selectedId);
  useEffect(() => {
    typesRef.current = types;
    selRef.current = selectedId;
  });
  const revision = useDetectStore((s) => s.revision);
  const findingsRevision = useChangesStore((s) => s.findingsRevision);
  const filters = useDetectStore((s) => s.filters);
  const layers = useRef<{
    boxes: VectorLayer<VectorSource>;
    dots: VectorLayer<VectorSource>;
  } | null>(null);
  // Bumped by refresh() below so a fetch started before a refresh can't add stale features to
  // the (now reloading) source once it resolves after the refresh (m1: refresh race).
  const generationRef = useRef(0);

  // Build effect: keyed on [map, api, projectId, run.id] only — z/opacity are property updates below
  // (RasterMount.tsx pattern, ruling T11-3) so an opacity drag never re-fetches every bbox.
  useEffect(() => {
    let stale = false;
    let densityRequested = false;
    const store = useDetectStore.getState;
    const boxes = new VectorSource({
      strategy: bboxStrategy,
      loader: (extent, _res, _proj, success, failure) => {
        const gen = generationRef.current;
        fetchSiteDetections(api, projectId, run.id, siteBbox(extent))
          .then((page) => {
            if (stale || gen !== generationRef.current) return;
            if (page.truncated) {
              // Too many detections in this extent for boxes (budget: <= 5 000 per viewport) —
              // show density dots instead, and don't leave this extent recorded as "loaded":
              // OL's bbox strategy treats any later extent contained in a loaded one as already
              // covered, so a wide truncated view would otherwise hide boxes forever even after
              // zooming into a small enough area. Nor are these ids "in view" for bulk review.
              boxes.removeLoadedExtent(extent);
              boxLayer.setVisible(false);
              dotLayer.setVisible(true);
              store().setInView(run.id, []);
              if (!densityRequested) {
                densityRequested = true;
                fetchSiteDensity(api, projectId, run.id)
                  .then((d) => {
                    if (stale || gen !== generationRef.current) return;
                    dots.addFeatures(
                      d.cells
                        .filter((c) => c.center_site)
                        .map((c) => {
                          const f = new Feature(new Point(c.center_site!));
                          f.setProperties({ classId: c.class_id, count: c.count });
                          return f;
                        }),
                    );
                  })
                  .catch(() => pushLog(`Could not load detection density for run ${run.id}.`));
              }
              success?.([]);
              return;
            }
            store().remember(run.id, page.items);
            const feats = page.items
              .filter((d) => d.corners_site && d.corners_site.length >= 3)
              .map((d) => {
                const c = d.corners_site!;
                const f = new Feature(new Polygon([[...c, c[0]]]));
                f.setId(d.id);
                f.set(SELECTION_PROP, detectionSelection(run.id, d.id));
                f.setProperties({
                  classId: d.class_id,
                  reviewState: d.review_state,
                  confidence: d.confidence,
                });
                return f;
              });
            boxes.addFeatures(feats);
            boxLayer.setVisible(true);
            dotLayer.setVisible(false);
            success?.(feats);
            reportInView();
          })
          .catch(() => {
            if (stale || gen !== generationRef.current) return;
            pushLog(`Could not load detections for run ${run.id}.`);
            boxes.removeLoadedExtent(extent);
            failure?.();
          });
      },
    });
    const dots = new VectorSource();
    const boxLayer = new VectorLayer({
      source: boxes,
      declutter: true,
      style: (f, res) => {
        const t = typesRef.current.get(f.get("classId") as string);
        const look = lookOf(
          { review_state: f.get("reviewState"), class_id: f.get("classId") },
          t?.kind,
          useDetectStore.getState().filters,
          f.getId() === selRef.current,
        );
        const ls = lookStyle(look, t?.colour);
        return ls ? olStyle(ls, f, res, tagText(t?.name, f.get("confidence") as number)) : undefined;
      },
    });
    const dotLayer = new VectorLayer({
      source: dots,
      visible: false,
      style: (f) => {
        const t = typesRef.current.get(f.get("classId") as string);
        const n = f.get("count") as number;
        return new Style({
          image: new Circle({
            radius: 3 + Math.sqrt(n) * 2,
            fill: new Fill({ color: paint(t?.colour ?? "token:accent", 0.55) }),
            stroke: new Stroke({ color: tokenColour("tip", 0.6), width: 1 }),
          }),
        });
      },
    });
    function reportInView() {
      if (stale) return;
      const extent = map.getView().calculateExtent(map.getSize());
      const ids = boxes
        .getFeaturesInExtent(extent)
        .filter((f) => f.get("reviewState") === "unreviewed")
        .map((f) => String(f.getId()));
      store().setInView(run.id, ids);
    }
    map.addLayer(boxLayer);
    map.addLayer(dotLayer);
    map.on("moveend", reportInView);
    layers.current = { boxes: boxLayer, dots: dotLayer };
    return () => {
      stale = true;
      map.un("moveend", reportInView);
      map.removeLayer(boxLayer);
      map.removeLayer(dotLayer);
      store().setInView(run.id, []);
      layers.current = null;
    };
  }, [map, api, projectId, run.id]);

  // z/opacity: property updates on the existing layers (RasterMount.tsx:77-83 pattern).
  useEffect(() => {
    layers.current?.boxes.setZIndex(zIndex);
    layers.current?.dots.setZIndex(zIndex + 1);
  }, [zIndex, map, api, projectId, run.id]);
  useEffect(() => {
    layers.current?.boxes.setOpacity(opacity);
    layers.current?.dots.setOpacity(opacity);
  }, [opacity, map, api, projectId, run.id]);

  // A map finding deleted in F's inspector rejects its detection and publishes only
  // findings.changed (M-B5 hand-off); refresh the box source so the box stops drawing accepted.
  // Skip the first run (mount): the build effect above already loads fresh data, and bumping the
  // generation here too would just make its own first load look stale to itself.
  const mountedRefreshRef = useRef(false);
  useEffect(() => {
    if (!mountedRefreshRef.current) {
      mountedRefreshRef.current = true;
      return;
    }
    generationRef.current++;
    layers.current?.boxes.getSource()?.refresh();
  }, [revision, findingsRevision]);
  useEffect(() => {
    layers.current?.boxes.changed();
  }, [filters, selectedId, types]);

  // Swipe: each run belongs to one survey date; clip its boxes/dots to that date's side
  // (RasterMount.tsx:85-99 pattern, ruling T11-5).
  const clipSide: "left" | "right" | null = mode === "swipe" ? (date === l ? "left" : "right") : null;
  useEffect(() => {
    const boxLayer = layers.current?.boxes;
    const dotLayer = layers.current?.dots;
    if (!clipSide || !boxLayer || !dotLayer) return;
    const detachBoxes = attachSwipeClip(
      boxLayer as unknown as ClipLayer,
      clipSide,
      () => workspace.getState().swipe,
    );
    const detachDots = attachSwipeClip(
      dotLayer as unknown as ClipLayer,
      clipSide,
      () => workspace.getState().swipe,
    );
    const unsubscribe = workspace.subscribe((s, prev) => {
      if (s.swipe !== prev.swipe) map.render();
    });
    map.render();
    return () => {
      detachBoxes();
      detachDots();
      unsubscribe();
      map.render();
    };
  }, [clipSide, map, workspace, api, projectId, run.id]);

  return null;
}

/** The AI detections row on one ol/Map (spec §9.3). Mounted only while the row is visible. */
export function DetectionMount({ map, zIndex, opacity, projectId }: LayerMountProps) {
  const api = useApi();
  const pane = useMapPane();
  const mode = useWorkspace((s) => s.mode);
  const l = useWorkspace((s) => s.l);
  const r = useWorkspace((s) => s.r);
  const surveys = useWorkspace((s) => s.surveys);
  const selection = useWorkspace((s) => s.selection);
  const allSurveys = useDetectStore((s) => s.filters.allSurveys);
  const outlines = useDetectStore((s) => s.outlines);
  const regionDraft = useDetectStore((s) => s.regionDraft);
  const { workspace } = useWorkspaceStores();
  const { types } = useProjectTypes(projectId);
  const [runs, setRuns] = useState<{ run: MapRun; date: string }[]>([]);
  const [tick, setTick] = useState(0);
  const onFinished = useCallback(() => setTick((t) => t + 1), []);
  useOnJobsFinished("map_detect", onFinished);

  const maps = useMemo(
    () => surveyMaps(surveys, sideDates({ mode, l, r }, pane.side), allSurveys),
    [surveys, mode, l, r, pane.side, allSurveys],
  );
  const mapKey = maps.map((m) => `${m.id}:${m.basisRunId ?? ""}`).join(",");
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      maps.map((m) =>
        listMapRuns(api, projectId, m.id).then((rs) =>
          shownRuns(rs, m.basisRunId).map((run) => ({ run, date: m.date })),
        ),
      ),
    )
      .then((per) => {
        if (cancelled) return;
        setRuns(per.flat());
        const jobs = useJobsStore.getState().jobs;
        const done = useDetectStore.getState().outlines.filter((o) => {
          const j = jobs[o.jobId];
          return j && j.state !== "queued" && j.state !== "running";
        });
        if (done.length) useDetectStore.getState().dropOutlines(done.map((o) => o.runId));
      })
      .catch(() => pushLog("Could not load the AI detection runs for the visible maps."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, projectId, mapKey, tick]);

  // Region outlines while a region run is going (spec §9.3).
  const outlineSource = useMemo(() => new VectorSource(), []);
  useEffect(() => {
    const layer = new VectorLayer({
      source: outlineSource,
      zIndex: zIndex + 2,
      style: new Style({
        stroke: new Stroke({
          color: tokenColour("accent"),
          width: 2,
          lineDash: [4, 4],
        }),
      }),
    });
    map.addLayer(layer);
    return () => {
      map.removeLayer(layer);
    };
  }, [map, outlineSource, zIndex]);
  // The box being configured in the region inspector is drawn only while region:draft is selected.
  const draftShown = selection?.kind === "region" && selection.id === "draft" ? regionDraft : null;
  useEffect(() => {
    outlineSource.clear();
    const rings = [...outlines.map((o) => o.ring), ...(draftShown ? [draftShown] : [])];
    outlineSource.addFeatures(rings.map((ring) => new Feature(new Polygon([[...ring, ring[0]]]))));
  }, [outlineSource, outlines, draftShown]);
  // Leaving region:draft (Esc, Cancel, another selection) drops the draft, so it never resurfaces.
  // A transition, not a state check: the draft is stored a moment before region:draft is selected.
  useEffect(
    () =>
      workspace.subscribe((s, prev) => {
        const wasDraft = prev.selection?.kind === "region" && prev.selection.id === "draft";
        const isDraft = s.selection?.kind === "region" && s.selection.id === "draft";
        if (wasDraft && !isDraft && useDetectStore.getState().regionDraft)
          useDetectStore.getState().setRegionDraft(null);
      }),
    [workspace],
  );

  const selectedId =
    selection?.kind === "detection" ? (parseDetectionId(selection.id)?.detectionId ?? null) : null;
  return (
    <>
      {runs.map(({ run, date }) => (
        <RunLayer
          key={run.id}
          map={map}
          projectId={projectId}
          run={run}
          date={date}
          types={types}
          opacity={opacity}
          zIndex={zIndex}
          selectedId={selectedId}
        />
      ))}
    </>
  );
}
