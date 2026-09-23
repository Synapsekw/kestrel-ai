import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type OlMap from "ol/Map";
import { boundingExtent } from "ol/extent";
import {
  mapTileUrl,
  type ClassDef,
  type GeoMap,
  type MapLabel,
  type MapRun,
  type MapScore,
  type MapZone,
} from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import {
  createLabel,
  createZone,
  deleteLabel,
  deleteZone,
  fetchDensity,
  fetchDetections,
  fetchScore,
  listLabels,
  listMapRuns,
  listMaps,
  listZones,
  seedLabels,
  updateLabel,
  updateZone,
  type MapLabelCreate,
  type MapLabelUpdate,
} from "@/api/maps";
import { useProject } from "@/api/project";
import { SiteAreaDrawBar } from "@/analytics/SiteAreaDrawBar";
import { useSiteAreaOverlay } from "@/analytics/useSiteAreaOverlay";
import { pushLog } from "@/app/diagnostics";
import { isTypingTarget } from "@/editor/hotkeys";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { ExportMapDialog } from "@/maps/ExportMapDialog";
import { ImportMapDialog } from "@/maps/ImportMapDialog";
import { LabelPanel } from "@/maps/LabelPanel";
import { MapList } from "@/maps/MapList";
import { MapOverlay } from "@/maps/MapOverlay";
import { MapView } from "@/maps/MapView";
import { NewRunDialog } from "@/maps/NewRunDialog";
import { ResultsPanel, type CountScope } from "@/maps/ResultsPanel";
import { RunList } from "@/maps/RunList";
import { ScorePanel } from "@/maps/ScorePanel";
import { makeReadout, type Readout } from "@/maps/coords";
import { fromOl, toOl } from "@/maps/grid";
import { useLabelLayers, type Tool } from "@/maps/labelLayers";
import { LabelHistory, outsideZones, pickClassCommand, type LabelApi } from "@/maps/labelModel";
import { type Match, type RunLayerSpec, useRunLayer } from "@/maps/runLayer";
import { matchLookup } from "@/maps/scoreView";
import {
  MAX_COMPARE,
  boxFacts,
  countsFromDensity,
  toggleCompare,
  type BoxFacts,
  type BoxGeom,
} from "@/maps/runModel";
import { Alert, Button, EmptyState, Segmented, toast } from "@/ui";

/**
 * Logs and toasts an async failure once, at the point it happens. Almost every mutating or
 * list-loading call on this screen used to be a `void x.then(...)` with no `.catch`: a failed
 * request simply vanished, leaving state (like `maps`) stuck forever with no message and no
 * retry. Returns the message so a caller that also needs it inline (the map list's own alert)
 * doesn't call `messageOf` a second time.
 */
function reportFailure(action: string, err: unknown): string {
  const message = messageOf(err, `could not ${action}`);
  pushLog(`${action} failed: ${message}`);
  toast("danger", message);
  return message;
}

type RightTab = "results" | "labels" | "score";

const nf = new Intl.NumberFormat("en-GB").format;
const px = (n: number) => nf(n).replace(/,/g, " ");
const EMPTY_CLASSES: ClassDef[] = [];

/** Stands in for the active map while none is loaded, so the run-layer hooks (rules of hooks)
 * always run; `useRunLayer` never reads it unless a run is actually selected, which cannot happen
 * without a real active map. */
const EMPTY_GEOMAP: GeoMap = {
  id: "",
  name: "",
  captured_on: null,
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

/**
 * The Maps screen. `readOnly` shows a training project's maps from before the split: maps, runs,
 * results, scores and export stay; importing, new runs, labeling, zones and deleting are gone.
 */
export function MapsScreen({ readOnly = false }: { readOnly?: boolean }) {
  const { projectId = "", mapId } = useParams();
  const mapsBase = readOnly ? `/p/${projectId}/past/maps` : `/p/${projectId}/maps`;
  const Heading = readOnly ? "h2" : "h1";
  const api = useApi();
  const navigate = useNavigate();
  const { baseUrl, token } = useBackend();
  const { project } = useProject(projectId);
  const [maps, setMaps] = useState<GeoMap[] | null>(null);
  const [mapsError, setMapsError] = useState<string | null>(null);
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
  const [inViewTruncated, setInViewTruncated] = useState<Record<string, boolean>>({});
  const [popover, setPopover] = useState<{ x: number; y: number; facts: BoxFacts } | null>(null);

  const [rightTab, setRightTab] = useState<RightTab>("results");
  const [zones, setZones] = useState<MapZone[]>([]);
  const [labels, setLabels] = useState<MapLabel[]>([]);
  const [scores, setScores] = useState<Record<string, MapScore | null>>({});
  // A run whose score request failed: `scores[id]` stays `null` (so the overlay/stepper treat it
  // the same as "not scored"), but this carries *why*, so the Score tab can tell "still loading"
  // apart from "failed" instead of showing a permanent "scoring…" for a request that already died.
  const [scoreErrors, setScoreErrors] = useState<Record<string, string>>({});
  const [overlay, setOverlay] = useState(true);
  const [exporting, setExporting] = useState(false);
  // Bumped every time a label or zone edit round-trips (create/update/delete/seed/undo/redo), so the
  // score effect below can refetch without needing `active.labels_version` to have round-tripped
  // through a full map reload first.
  const [editVersion, setEditVersion] = useState(0);
  const [tool, setTool] = useState<Tool>("pan");
  const [activeClassId, setActiveClassId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const history = useRef(new LabelHistory());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const bumpHistory = useCallback(() => {
    setCanUndo(history.current.canUndo);
    setCanRedo(history.current.canRedo);
  }, []);

  const reload = useCallback(() => {
    void listMaps(api, projectId)
      .then((ms) => {
        setMaps(ms);
        setMapsError(null);
      })
      .catch((err: unknown) => setMapsError(reportFailure("load maps", err)));
  }, [api, projectId]);
  useEffect(reload, [reload]);
  useOnJobsFinished("map_import", reload);

  const active = maps?.find((m) => m.id === mapId) ?? null;
  // Site areas (plan 2 unit A): outlines on the map, and the outline tool for `?draw=site-area`.
  const siteAreas = useSiteAreaOverlay(olMap, active, projectId, !readOnly);
  const read = useMemo(() => (active ? makeReadout(active) : null), [active]);
  const tileUrl = active ? mapTileUrl(baseUrl, token, projectId, active.id) : "";

  // The previous state of each run, so a run that just turned "succeeded" (and only that one) is
  // picked up for comparison automatically; a run already known to be done never re-selects itself.
  const priorStates = useRef<Record<string, string | null>>({});
  const reloadRuns = useCallback(() => {
    if (!active) return;
    void listMapRuns(api, projectId, active.id)
      .then((rs) => {
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
      })
      .catch((err: unknown) => reportFailure("load runs", err));
  }, [api, projectId, active]);
  // Switching the active map clears the comparison and run list for the new map: a render-phase
  // state adjustment (React's "reset state on a changed key" pattern), not an effect, since it is
  // itself a synchronous setState.
  const [trackedMapId, setTrackedMapId] = useState(active?.id);
  if (active?.id !== trackedMapId) {
    setTrackedMapId(active?.id);
    setSelected([]);
    setRuns([]);
    setScores({});
    setScoreErrors({});
    // `priorStates` itself resets naturally: run ids are UUIDs, so a leftover entry from the
    // previous map never matches one of the new map's run ids.
  }
  useEffect(() => {
    reloadRuns();
  }, [reloadRuns]);
  useOnJobsFinished("map_detect", reloadRuns);

  const reloadZones = useCallback(() => {
    if (!active) return Promise.resolve();
    return listZones(api, projectId, active.id)
      .then((zs) => {
        setZones(zs);
        setEditVersion((v) => v + 1);
      })
      .catch((err: unknown) => {
        reportFailure("load zones", err);
      });
  }, [api, projectId, active]);
  const reloadLabels = useCallback(() => {
    if (!active) return Promise.resolve();
    return listLabels(api, projectId, active.id)
      .then((ls) => {
        setLabels(ls);
        setEditVersion((v) => v + 1);
      })
      .catch((err: unknown) => {
        reportFailure("load labels", err);
      });
  }, [api, projectId, active]);
  useEffect(() => {
    void reloadZones();
    void reloadLabels();
  }, [reloadZones, reloadLabels]);

  // Every label edit is an immediate API call, so undo/redo simply replays these three calls; the
  // history remaps ids after a re-create (Task 13 spec).
  const labelApi = useMemo<LabelApi>(
    () => ({
      create: async (body) => {
        if (!active) throw new Error("no active map");
        const label = await createLabel(api, projectId, active.id, body);
        await reloadLabels();
        return label.id;
      },
      update: async (id, body) => {
        if (!active) throw new Error("no active map");
        await updateLabel(api, projectId, active.id, id, body);
        await reloadLabels();
      },
      remove: async (id) => {
        if (!active) throw new Error("no active map");
        await deleteLabel(api, projectId, active.id, id);
        await reloadLabels();
      },
    }),
    [api, projectId, active, reloadLabels],
  );

  // Undo/redo replay a server call, so two in flight at once is how a stale-id race becomes
  // visible: an in-flight flag serialises them (a queued keypress is dropped, not deferred) and
  // also disables the toolbar buttons for the same span. A rejected replay (e.g. a lost recreate)
  // is logged rather than thrown into an unhandled rejection; `LabelHistory` already put the
  // command back where it came from, so the operator can simply try again.
  const historyBusy = useRef(false);
  const [historyBusyState, setHistoryBusyState] = useState(false);
  const runHistoryOp = useCallback(
    (op: (api: LabelApi) => Promise<boolean>) => {
      if (historyBusy.current) return;
      historyBusy.current = true;
      setHistoryBusyState(true);
      void op(labelApi)
        .then(bumpHistory)
        .catch((err: unknown) => pushLog(`label history: ${err instanceof Error ? err.message : err}`))
        .finally(() => {
          historyBusy.current = false;
          setHistoryBusyState(false);
        });
    },
    [labelApi, bumpHistory],
  );
  const doUndo = useCallback(() => runHistoryOp((a) => history.current.undo(a)), [runHistoryOp]);
  const doRedo = useCallback(() => runHistoryOp((a) => history.current.redo(a)), [runHistoryOp]);

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
      void fetchDensity(api, projectId, runId, 1, minConf)
        .then((d) => {
          if (!cancelled) setWholeMap((w) => ({ ...w, [runId]: countsFromDensity(d) }));
        })
        .catch((err: unknown) => {
          if (!cancelled) reportFailure("load whole-map counts", err);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [api, projectId, liveSelected, minConf]);

  const classes = useMemo(() => project?.classes ?? EMPTY_CLASSES, [project]);
  const colours = useMemo(() => Object.fromEntries(classes.map((c) => [c.id, c.colour])), [classes]);

  // Scores for every ticked run (spec section 8): a run can only be scored once it has finished, so
  // this reuses `liveSelected` (a finished run's id is only in `selected` after `RunList` lets it be
  // ticked). Refetches on a label/zone edit (`editVersion`) and whenever the run list itself changes
  // (a `map_detect` job finishing updates `runs`, which `reloadRuns` already listens for). `scores`
  // itself is never cleared here: a deselected run's stale entry is simply filtered out below, so
  // this effect body never needs a synchronous `setState` of its own (only inside the fetch callback).
  useEffect(() => {
    if (liveSelected.length === 0) return;
    let cancelled = false;
    for (const runId of liveSelected) {
      void fetchScore(api, projectId, runId)
        .then((s) => {
          if (cancelled) return;
          setScores((sc) => ({ ...sc, [runId]: s }));
          // A retry (label edit, run refresh) that now succeeds clears a stale failure for this run.
          setScoreErrors((se) => {
            if (!(runId in se)) return se;
            const next = { ...se };
            delete next[runId];
            return next;
          });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          pushLog(`score run ${runId} failed: ${messageOf(err, String(err))}`);
          // `scores[runId]` stays `null` (never scored), and the reason lives in `scoreErrors` so
          // `ScorePanel` can show "failed" instead of a "scoring…" that would never resolve.
          setScores((sc) => ({ ...sc, [runId]: null }));
          setScoreErrors((se) => ({ ...se, [runId]: messageOf(err, "could not score this run") }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [api, projectId, liveSelected, editVersion]);
  // The scores/errors actually relevant right now: a run just deselected, or left over from a
  // previous map, still has an entry until the effect above refetches it, so callers key off these
  // filtered views instead of `scores`/`scoreErrors` directly.
  const liveScores = useMemo(() => {
    const out: Record<string, MapScore | null> = {};
    for (const id of liveSelected) if (id in scores) out[id] = scores[id];
    return out;
  }, [scores, liveSelected]);
  const liveScoreErrors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const id of liveSelected) if (id in scoreErrors) out[id] = scoreErrors[id];
    return out;
  }, [scoreErrors, liveSelected]);

  const specFor = useCallback(
    (
      runId: string | undefined,
      dashed: boolean,
      matchOf?: (id: string) => Match | undefined,
    ): RunLayerSpec | null => {
      if (!runId) return null;
      return {
        runId,
        dashed,
        minConf,
        hidden,
        colours,
        matchOf,
        load: (bbox, c) => fetchDetections(api, projectId, runId, bbox, c),
        density: (c) => fetchDensity(api, projectId, runId, 128, c),
        onViewCounts: (counts, truncated) => {
          setInView((v) => ({ ...v, [runId]: counts }));
          setInViewTruncated((t) => ({ ...t, [runId]: truncated }));
        },
      };
    },
    [api, projectId, minConf, hidden, colours],
  );
  // Only the first (primary) run is coloured by match status: it is the run the Score tab's mistake
  // list and per-class table are built from, so it is the only one whose overlay stays coherent with
  // what "Next mistake" steps through. A second, comparison run keeps its ordinary/dashed colours.
  const primaryScore = liveScores[liveSelected[0]] ?? null;
  const spec1 = useMemo(
    () => specFor(liveSelected[0], false, overlay ? matchLookup(primaryScore, "detection") : undefined),
    [specFor, liveSelected, overlay, primaryScore],
  );
  const spec2 = useMemo(() => specFor(liveSelected[1], true), [specFor, liveSelected]);
  useRunLayer(olMap, active ?? EMPTY_GEOMAP, spec1);
  useRunLayer(olMap, active ?? EMPTY_GEOMAP, spec2);

  const onStepMistake = useCallback(
    (m: MapScore["matches"][number]) => {
      if (!olMap || !active) return;
      olMap.getView().fit(boundingExtent([toOl(m.x, m.y), toOl(m.x + m.w, m.y + m.h)]), {
        padding: [120, 120, 120, 120],
        maxZoom: active.tile_grid.max_zoom,
        duration: 250,
      });
    },
    [olMap, active],
  );

  const effectiveClassId = activeClassId || classes[0]?.id || "";
  const warnIds = useMemo(() => outsideZones(labels, zones), [labels, zones]);
  const seededCount = useMemo(() => labels.filter((l) => l.source.startsWith("from_run:")).length, [labels]);
  const selectedLabel = useMemo(() => labels.find((l) => l.id === selectedId) ?? null, [labels, selectedId]);

  // Picking a class (hotkey or class-row click): reclass the selected label in place when one is
  // selected, or fall back to setting the drawing class for the next box (spec section on boxes:
  // "draw, move and resize, delete, reclass"). `pickClassCommand` is the pure decision so it can be
  // unit-tested without an OpenLayers selection.
  const pickClass = useCallback(
    (classId: string) => {
      const cmd = pickClassCommand(selectedLabel, classId);
      if (cmd.kind === "set-active") {
        setActiveClassId(classId);
        return;
      }
      void labelApi
        .update(cmd.id, cmd.after)
        .then(() => {
          history.current.record({ kind: "update", id: cmd.id, before: cmd.before, after: cmd.after });
          bumpHistory();
        })
        .catch((err: unknown) => reportFailure("reclass label", err));
    },
    [selectedLabel, labelApi, bumpHistory],
  );

  useLabelLayers(olMap, active ?? EMPTY_GEOMAP, {
    labels,
    zones,
    colours,
    tool: rightTab === "labels" ? tool : "pan",
    selectedId,
    warnIds,
    matchOf: overlay ? matchLookup(primaryScore, "label") : undefined,
    onBox: (box) => {
      if (!active || !effectiveClassId) return;
      const body: MapLabelCreate = { class_id: effectiveClassId, x: box.x, y: box.y, w: box.w, h: box.h };
      void labelApi
        .create(body)
        .then((id) => {
          history.current.record({ kind: "create", id, body });
          bumpHistory();
        })
        .catch((err: unknown) => reportFailure("create label", err));
    },
    onZone: (polygon) => {
      if (!active) return;
      void createZone(api, projectId, active.id, { name: `Zone ${zones.length + 1}`, polygon })
        .then(() => reloadZones())
        .catch((err: unknown) => reportFailure("create zone", err));
    },
    onEdit: (id, box) => {
      const existing = labels.find((l) => l.id === id);
      if (!existing) return;
      const before: MapLabelUpdate = { x: existing.x, y: existing.y, w: existing.w, h: existing.h };
      const after: MapLabelUpdate = { x: box.x, y: box.y, w: box.w, h: box.h };
      void labelApi
        .update(id, after)
        .then(() => {
          history.current.record({ kind: "update", id, before, after });
          bumpHistory();
        })
        .catch((err: unknown) => reportFailure("update label", err));
    },
    onSelect: setSelectedId,
  });

  // Hotkeys: only while the Labels tab is open, and never while typing into a field.
  useEffect(() => {
    if (rightTab !== "labels") return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl) {
        const lower = e.key.toLowerCase();
        if (lower === "z" || lower === "y") {
          // A held key must not queue one replay per auto-repeat tick (matches the editor's own
          // undo/redo guard in `editor/hotkeys.ts`); `runHistoryOp` also refuses a second replay
          // while one is still in flight.
          if (e.repeat) return;
          e.preventDefault();
          if (lower === "y" || e.shiftKey) doRedo();
          else doUndo();
        }
        return;
      }
      if (e.key === "Escape") {
        setTool("pan");
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (!selectedId) return;
        const existing = labels.find((l) => l.id === selectedId);
        if (!existing) return;
        const id = selectedId;
        const body: MapLabelCreate = {
          class_id: existing.class_id,
          x: existing.x,
          y: existing.y,
          w: existing.w,
          h: existing.h,
        };
        setSelectedId(null);
        void labelApi
          .remove(id)
          .then(() => {
            history.current.record({ kind: "delete", id, body });
            bumpHistory();
          })
          .catch((err: unknown) => reportFailure("delete label", err));
        return;
      }
      const lower = e.key.toLowerCase();
      if (lower === "b") {
        setTool("box");
        return;
      }
      if (lower === "z") {
        setTool("zone-rect");
        return;
      }
      const cls = classes.find((c) => c.hotkey === e.key);
      if (cls) pickClass(cls.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rightTab, labelApi, selectedId, labels, classes, bumpHistory, doUndo, doRedo, pickClass]);

  // The box popover (spec section 7): the class, confidence, centre readout and size of whatever
  // detection box sits under the pointer.
  useEffect(() => {
    if (!olMap || !active) return;
    const onClick = (e: { pixel: number[] }) => {
      // `kind === "detection"` excludes ground-truth label features, which share the `classId`
      // property but have no confidence to show (see `labelLayers.ts`).
      const feature = olMap.forEachFeatureAtPixel(e.pixel, (f) =>
        f.get("kind") === "detection" ? f : undefined,
      );
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

  if (maps && maps.length === 0 && readOnly) {
    return (
      <EmptyState icon="map" title="No past maps">
        This project has no maps from before training and detection were split.
      </EmptyState>
    );
  }

  if (maps && maps.length === 0 && !importing) {
    return (
      <EmptyState
        className="h-full p-6"
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
    <div className="flex h-full min-h-0 w-full">
      <section className="flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line p-3 xl:w-64">
        <div className="flex items-center justify-between">
          <Heading className="text-xl font-semibold tracking-tight">Maps</Heading>
          {!readOnly && (
            <Button size="sm" icon="import" onClick={() => setImporting(true)}>
              Import map
            </Button>
          )}
        </div>
        {maps ? (
          <MapList projectId={projectId} maps={maps} activeId={mapId} basePath={mapsBase} />
        ) : (
          mapsError && (
            <Alert
              tone="danger"
              actions={
                <Button size="sm" icon="refresh" onClick={reload}>
                  Retry
                </Button>
              }
            >
              {mapsError}
            </Alert>
          )
        )}
        {active && (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Runs</h2>
              {!readOnly && (
                <Button
                  size="sm"
                  variant="primary"
                  icon="detect"
                  disabled={active.status !== "ready"}
                  onClick={() => setNewRun(true)}
                >
                  New run
                </Button>
              )}
            </div>
            <RunList
              projectId={projectId}
              runs={runs}
              selected={selected}
              onToggle={(id) => setSelected((s) => toggleCompare(s, id))}
              onChanged={reloadRuns}
              readOnly={readOnly}
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
            {siteAreas.drawMode && (
              <SiteAreaDrawBar
                projectId={projectId}
                mapId={active.id}
                polygon={siteAreas.polygon}
                onCancel={siteAreas.cancel}
                onSaved={siteAreas.saved}
              />
            )}
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
            {active?.error ??
              (readOnly ? "Pick a map on the left." : "Pick a map on the left, or import one.")}
          </EmptyState>
        )}
      </section>
      <aside
        data-testid="map-panel"
        className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line p-4 xl:w-80"
      >
        {active && (
          <>
            <div className="flex items-center justify-between gap-2">
              <h2 className="min-w-0 truncate text-base font-semibold">{active.name}</h2>
              <Button size="sm" icon="download" onClick={() => setExporting(true)}>
                Export
              </Button>
            </div>
            <MapFacts m={active} />
            {!active.crs_wkt && (
              <Alert tone="warn">
                No coordinates in this file: you can view, detect, label and score, and export boxes in
                pixels, but not as GIS layers.
              </Alert>
            )}
            <Segmented
              label="Right panel"
              size="sm"
              value={rightTab}
              onChange={setRightTab}
              options={
                readOnly
                  ? [
                      { value: "results", label: "Results" },
                      { value: "score", label: "Score" },
                    ]
                  : [
                      { value: "results", label: "Results" },
                      { value: "labels", label: "Labels" },
                      { value: "score", label: "Score" },
                    ]
              }
            />
            {rightTab === "results" ? (
              liveSelected.length > 0 ? (
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
              )
            ) : rightTab === "score" ? (
              <ScorePanel
                runs={runs}
                selected={liveSelected}
                scores={liveScores}
                scoreErrors={liveScoreErrors}
                classes={classes}
                overlay={overlay}
                onOverlay={setOverlay}
                onStep={onStepMistake}
              />
            ) : (
              <LabelPanel
                tool={tool}
                onTool={setTool}
                classes={classes}
                activeClassId={effectiveClassId}
                onClass={pickClass}
                selectedClassId={selectedLabel?.class_id ?? null}
                zones={zones}
                labels={labels}
                warnCount={warnIds.size}
                seededCount={seededCount}
                runs={runs}
                minConf={minConf}
                onSeed={(runId, zoneId, minConfSeed) =>
                  void seedLabels(api, projectId, active.id, {
                    run_id: runId,
                    zone_id: zoneId,
                    min_conf: minConfSeed,
                  })
                    .then(() => reloadLabels())
                    .catch((err: unknown) => reportFailure("seed labels", err))
                }
                onRenameZone={(id, name) =>
                  void updateZone(api, projectId, active.id, id, { name })
                    .then(() => reloadZones())
                    .catch((err: unknown) => reportFailure("rename zone", err))
                }
                onDeleteZone={(id) =>
                  void deleteZone(api, projectId, active.id, id)
                    .then(() => reloadZones())
                    .catch((err: unknown) => reportFailure("delete zone", err))
                }
                canUndo={canUndo && !historyBusyState}
                canRedo={canRedo && !historyBusyState}
                onUndo={doUndo}
                onRedo={doRedo}
              />
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
            navigate(`${mapsBase}/${m.id}`);
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
      {exporting && active && (
        <ExportMapDialog
          projectId={projectId}
          geoMap={active}
          runs={runs}
          selectedRunId={selected[0] ?? null}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  );
}
