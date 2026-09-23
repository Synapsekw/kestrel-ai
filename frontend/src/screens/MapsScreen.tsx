import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type OlMap from "ol/Map";
import { mapTileUrl, type ClassDef, type GeoMap, type MapRun } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { fetchDensity, fetchDetections, listMapRuns, listMaps } from "@/api/maps";
import { useProject } from "@/api/project";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { ImportMapDialog } from "@/maps/ImportMapDialog";
import { MapList } from "@/maps/MapList";
import { MapOverlay } from "@/maps/MapOverlay";
import { MapView } from "@/maps/MapView";
import { NewRunDialog } from "@/maps/NewRunDialog";
import { ResultsPanel, type CountScope } from "@/maps/ResultsPanel";
import { RunList } from "@/maps/RunList";
import { makeReadout, type Readout } from "@/maps/coords";
import { fromOl } from "@/maps/grid";
import { type RunLayerSpec, useRunLayer } from "@/maps/runLayer";
import {
  MAX_COMPARE,
  boxFacts,
  countsFromDensity,
  toggleCompare,
  type BoxFacts,
  type BoxGeom,
} from "@/maps/runModel";
import { Alert, Button, EmptyState } from "@/ui";

const nf = new Intl.NumberFormat("en-GB").format;
const px = (n: number) => nf(n).replace(/,/g, " ");
const EMPTY_CLASSES: ClassDef[] = [];

/** Stands in for the active map while none is loaded, so the run-layer hooks (rules of hooks)
 * always run; `useRunLayer` never reads it unless a run is actually selected, which cannot happen
 * without a real active map. */
const EMPTY_GEOMAP: GeoMap = {
  id: "",
  name: "",
  status: "ready",
  error: null,
  source_path: "",
  source_size: 0,
  width: 0,
  height: 0,
  band_count: 0,
  dtype: "",
  crs_wkt: null,
  epsg: null,
  proj4: null,
  geotransform: null,
  bounds_native: null,
  bounds_wgs84: null,
  gsd_cm: null,
  tile_grid: { tile_size: 256, max_zoom: 0 },
  labels_version: 0,
  job_id: null,
  created_at: "",
};

function MapFacts({ m }: { m: GeoMap }) {
  const rows: [string, string][] = [
    ["Size", `${px(m.width)} × ${px(m.height)} px`],
    ["Ground resolution", m.gsd_cm ? `${m.gsd_cm.toFixed(1)} cm / px` : "unknown"],
    ["Coordinate system", m.epsg ? `EPSG:${m.epsg}` : m.crs_wkt ? "custom (see export)" : "none"],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right tabular-nums text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MapsScreen() {
  const { projectId = "", mapId } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const { baseUrl, token } = useBackend();
  const { project } = useProject(projectId);
  const [maps, setMaps] = useState<GeoMap[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [olMap, setOlMap] = useState<OlMap | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [resolution, setResolution] = useState(1);

  const [runs, setRuns] = useState<MapRun[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [newRun, setNewRun] = useState(false);
  const [minConf, setMinConf] = useState(0.25);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<CountScope>("map");
  const [wholeMap, setWholeMap] = useState<Record<string, Record<string, number>>>({});
  const [inView, setInView] = useState<Record<string, Record<string, number>>>({});
  const [inViewTruncated, setInViewTruncated] = useState(false);
  const [popover, setPopover] = useState<{ x: number; y: number; facts: BoxFacts } | null>(null);

  const reload = useCallback(() => {
    void listMaps(api, projectId).then(setMaps);
  }, [api, projectId]);
  useEffect(reload, [reload]);
  useOnJobsFinished("map_import", reload);

  const active = maps?.find((m) => m.id === mapId) ?? null;
  const read = useMemo(() => (active ? makeReadout(active) : null), [active]);
  const tileUrl = active ? mapTileUrl(baseUrl, token, projectId, active.id) : "";

  // The previous state of each run, so a run that just turned "succeeded" (and only that one) is
  // picked up for comparison automatically; a run already known to be done never re-selects itself.
  const priorStates = useRef<Record<string, string | null>>({});
  const reloadRuns = useCallback(() => {
    if (!active) return;
    void listMapRuns(api, projectId, active.id).then((rs) => {
      const prior = priorStates.current;
      priorStates.current = Object.fromEntries(rs.map((r) => [r.id, r.state]));
      setRuns(rs);
      const justFinished = rs.find(
        (r) => r.state === "succeeded" && prior[r.id] !== undefined && prior[r.id] !== "succeeded",
      );
      if (justFinished) {
        setSelected((sel) =>
          sel.length < MAX_COMPARE && !sel.includes(justFinished.id) ? [...sel, justFinished.id] : sel,
        );
      }
    });
  }, [api, projectId, active]);
  // Switching the active map clears the comparison and run list for the new map: a render-phase
  // state adjustment (React's "reset state on a changed key" pattern), not an effect, since it is
  // itself a synchronous setState.
  const [trackedMapId, setTrackedMapId] = useState(active?.id);
  if (active?.id !== trackedMapId) {
    setTrackedMapId(active?.id);
    setSelected([]);
    setRuns([]);
    // `priorStates` itself resets naturally: run ids are UUIDs, so a leftover entry from the
    // previous map never matches one of the new map's run ids.
  }
  useEffect(() => {
    reloadRuns();
  }, [reloadRuns]);
  useOnJobsFinished("map_detect", reloadRuns);

  // Filters out a run id from a map just switched away from: `selected` and `runs` each clear on
  // their own effect after a map change, so for one render they can briefly disagree.
  const liveSelected = useMemo(
    () => selected.filter((id) => runs.some((r) => r.id === id)),
    [selected, runs],
  );

  // Whole-map counts at the current confidence: one density cell covers the entire map.
  useEffect(() => {
    if (liveSelected.length === 0) return;
    let cancelled = false;
    for (const runId of liveSelected) {
      void fetchDensity(api, projectId, runId, 1, minConf).then((d) => {
        if (!cancelled) setWholeMap((w) => ({ ...w, [runId]: countsFromDensity(d) }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [api, projectId, liveSelected, minConf]);

  const classes = useMemo(() => project?.classes ?? EMPTY_CLASSES, [project]);
  const colours = useMemo(() => Object.fromEntries(classes.map((c) => [c.id, c.colour])), [classes]);

  const specFor = useCallback(
    (runId: string | undefined, dashed: boolean): RunLayerSpec | null => {
      if (!runId) return null;
      return {
        runId,
        dashed,
        minConf,
        hidden,
        colours,
        load: (bbox, c) => fetchDetections(api, projectId, runId, bbox, c),
        density: (c) => fetchDensity(api, projectId, runId, 128, c),
        onViewCounts: (counts, truncated) => {
          setInView((v) => ({ ...v, [runId]: counts }));
          setInViewTruncated(truncated);
        },
      };
    },
    [api, projectId, minConf, hidden, colours],
  );
  const spec1 = useMemo(() => specFor(liveSelected[0], false), [specFor, liveSelected]);
  const spec2 = useMemo(() => specFor(liveSelected[1], true), [specFor, liveSelected]);
  useRunLayer(olMap, active ?? EMPTY_GEOMAP, spec1);
  useRunLayer(olMap, active ?? EMPTY_GEOMAP, spec2);

  // The box popover (spec section 7): the class, confidence, centre readout and size of whatever
  // detection box sits under the pointer.
  useEffect(() => {
    if (!olMap || !active) return;
    const onClick = (e: { pixel: number[] }) => {
      const feature = olMap.forEachFeatureAtPixel(e.pixel, (f) => (f.get("classId") ? f : undefined));
      if (!feature) {
        setPopover(null);
        return;
      }
      const extent = feature.getGeometry()?.getExtent();
      if (!extent) return;
      const [x0, y0] = fromOl([extent[0], extent[3]]);
      const [x1, y1] = fromOl([extent[2], extent[1]]);
      const box: BoxGeom = {
        x: x0,
        y: y0,
        w: x1 - x0,
        h: y1 - y0,
        classId: (feature.get("classId") as string) ?? "",
      };
      const confidence = (feature.get("confidence") as number | undefined) ?? 0;
      setPopover({ x: e.pixel[0], y: e.pixel[1], facts: boxFacts(active, box, classes, confidence) });
    };
    olMap.on("singleclick", onClick);
    return () => olMap.un("singleclick", onClick);
  }, [olMap, active, classes]);
  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopover(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover]);

  if (maps && maps.length === 0 && !importing) {
    return (
      <EmptyState
        icon="map"
        title="Import a GeoTIFF map"
        action={
          <Button variant="primary" icon="import" onClick={() => setImporting(true)}>
            Import map
          </Button>
        }
      >
        Bring in an orthomosaic, run your models across the whole site and count every machine on it.
      </EmptyState>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line p-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Maps</h1>
          <Button size="sm" icon="import" onClick={() => setImporting(true)}>
            Import map
          </Button>
        </div>
        {maps && <MapList projectId={projectId} maps={maps} activeId={mapId} />}
        {active && (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Runs</h2>
              <Button
                size="sm"
                variant="primary"
                icon="detect"
                disabled={active.status !== "ready"}
                onClick={() => setNewRun(true)}
              >
                New run
              </Button>
            </div>
            <RunList
              projectId={projectId}
              runs={runs}
              selected={selected}
              onToggle={(id) => setSelected((s) => toggleCompare(s, id))}
              onChanged={reloadRuns}
            />
          </div>
        )}
      </section>
      <section className="relative min-w-0 flex-1">
        {active?.status === "ready" ? (
          <>
            <MapView
              geoMap={active}
              tileUrl={tileUrl}
              onReady={setOlMap}
              onPointer={(x, y) => setReadout(read ? read(x, y) : null)}
              onViewChange={(v) => setResolution(v.resolution)}
            />
            <MapOverlay map={olMap} geoMap={active} readout={readout} resolution={resolution} />
            {popover && (
              <div
                className="absolute z-10 flex max-w-64 flex-col gap-1 rounded-md border border-line bg-panel p-2.5 text-xs shadow-float"
                style={{ left: popover.x, top: popover.y }}
              >
                <p className="font-medium text-ink">{popover.facts.title}</p>
                <p className="text-muted">{popover.facts.readout.pixel}</p>
                {popover.facts.readout.native && <p className="text-muted">{popover.facts.readout.native}</p>}
                {popover.facts.readout.wgs84 && <p className="text-ink">{popover.facts.readout.wgs84}</p>}
                {popover.facts.size && <p className="text-muted">{popover.facts.size}</p>}
              </div>
            )}
          </>
        ) : (
          <EmptyState icon="map" title={active ? `${active.name} is ${active.status}` : "Choose a map"}>
            {active?.error ?? "Pick a map on the left, or import one."}
          </EmptyState>
        )}
      </section>
      <aside
        data-testid="map-panel"
        className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line p-4"
      >
        {active && (
          <>
            <h2 className="truncate text-base font-semibold">{active.name}</h2>
            <MapFacts m={active} />
            {!active.crs_wkt && (
              <Alert tone="warn">
                No coordinates in this file: you can view, detect, label and score, and export boxes in
                pixels, but not as GIS layers.
              </Alert>
            )}
            {liveSelected.length > 0 ? (
              <ResultsPanel
                runs={runs}
                selected={liveSelected}
                classes={classes}
                wholeMap={wholeMap}
                inView={inView}
                inViewTruncated={inViewTruncated}
                scope={scope}
                onScope={setScope}
                minConf={minConf}
                onMinConf={setMinConf}
                hidden={hidden}
                onToggleClass={(classId) =>
                  setHidden((h) => {
                    const next = new Set(h);
                    if (next.has(classId)) next.delete(classId);
                    else next.add(classId);
                    return next;
                  })
                }
              />
            ) : (
              <p className="text-sm text-muted">Tick a finished run to see its boxes and counts.</p>
            )}
          </>
        )}
      </aside>
      {importing && (
        <ImportMapDialog
          projectId={projectId}
          onClose={() => setImporting(false)}
          onStarted={(m) => {
            setImporting(false);
            reload();
            navigate(`/p/${projectId}/maps/${m.id}`);
          }}
        />
      )}
      {newRun && active && (
        <NewRunDialog
          projectId={projectId}
          geoMap={active}
          runs={runs}
          onClose={() => setNewRun(false)}
          onStarted={() => {
            setNewRun(false);
            reloadRuns();
          }}
        />
      )}
    </div>
  );
}
