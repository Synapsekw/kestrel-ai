import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type OlMap from "ol/Map";
import {
  surfaceOrthoTileUrl,
  surfaceTileUrl,
  volumeDiffTileUrl,
  type Surface,
  type VolumeMeasurement,
} from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import {
  deleteSurface,
  listCloudsForBuild,
  listSurfaces,
  sampleSurface,
  type PointCloudOut,
} from "@/api/surfaces";
import {
  calculateVolume,
  createVolume,
  fetchFootprints,
  listVolumes,
  patchVolume,
  type VolumeMeasurementPatch,
} from "@/api/volumes";
import { pushLog } from "@/app/diagnostics";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { ImportDesignButton } from "@/surfaces/ImportDesignButton";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, EmptyState, Pill, Segmented, Switch, toast } from "@/ui";
import { BuildSurfaceDialog } from "@/volumes/BuildSurfaceDialog";
import { ExportVolumesDialog } from "@/volumes/ExportVolumesDialog";
import { MeasurePanel } from "@/volumes/MeasurePanel";
import { SurfaceList } from "@/volumes/SurfaceList";
import { SurfaceOverlay, type SurfaceReadout } from "@/volumes/SurfaceOverlay";
import { SurfaceView } from "@/volumes/SurfaceView";
import { VolumeResultsPanel } from "@/volumes/VolumeResultsPanel";
import { VolumeToolbar } from "@/volumes/VolumeToolbar";
import { useDiffLayer } from "@/volumes/diffLayer";
import { headline, nextName, pixelToNative, staleText } from "@/volumes/model";
import { useVolumeLayers, type VolumeTool } from "@/volumes/volumeLayers";

const SAMPLE_MS = 150;
// Stable references for "nothing": the layer hook re-draws whenever these change identity.
const NO_GT = [0, 1, 0, 0, 0, -1];
const NO_EXCLUSIONS: VolumeMeasurement["masks"]["exclusion_polygons"] = [];
const NO_FOOTPRINTS: number[][][] = [];
const STATUS_TONE = { ready: "ok", stale: "warn", calculating: "neutral", failed: "danger" } as const;
const STATUS_TEXT = { ready: "Ready", stale: "Stale", calculating: "Calculating", failed: "Failed" } as const;

function report(action: string, err: unknown): void {
  const message = messageOf(err, `could not ${action}`);
  pushLog(`${action} failed: ${message}`);
  toast("danger", message);
}

/**
 * Volumes (spec 2026-09-23-volumes section 9): surfaces and measurements on the left, the top
 * surface's hillshade (over the ortho of the same flight) with the drawing tools in the middle, and
 * a Measure | Results aside. Every drawn or edited ring is saved at once; numbers only ever come
 * from a `volume_calc` job.
 */
export function VolumesScreen() {
  const { projectId = "", measurementId } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const { baseUrl, token } = useBackend();
  const surfacesRevision = useChangesStore((s) => s.surfacesRevision);
  const volumesRevision = useChangesStore((s) => s.volumesRevision);
  const [surfaces, setSurfaces] = useState<Surface[] | null>(null);
  const [clouds, setClouds] = useState<PointCloudOut[]>([]);
  const [measurements, setMeasurements] = useState<VolumeMeasurement[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickedSurface, setPickedSurface] = useState<string | null>(null);
  const [building, setBuilding] = useState<{ cloudId?: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [olMap, setOlMap] = useState<OlMap | null>(null);
  const [resolution, setResolution] = useState(1);
  const [readout, setReadout] = useState<SurfaceReadout | null>(null);
  const [tool, setTool] = useState<VolumeTool>("pan");
  const [orthoOn, setOrthoOn] = useState(true);
  const [diffOn, setDiffOn] = useState(true);
  const [selectedExclusion, setSelectedExclusion] = useState<string | null>(null);
  const [loadedFootprints, setLoadedFootprints] = useState<{
    measurementId: string;
    rings: number[][][];
  } | null>(null);
  const [picking, setPicking] = useState(false);

  const reload = useCallback(() => {
    Promise.all([listSurfaces(api, projectId), listVolumes(api, projectId)])
      .then(([s, v]) => {
        setSurfaces(s);
        setMeasurements(v);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(messageOf(err, "could not load surfaces and volumes")));
    // The clouds only offer "Build surface": without them (point clouds not built yet answer 501)
    // the screen still lists its surfaces and measurements, and asks for a point cloud first.
    listCloudsForBuild(api, projectId)
      .then(setClouds)
      .catch((err: unknown) => {
        if (!isNotImplemented(err))
          pushLog(`load the point clouds failed: ${messageOf(err, "unknown error")}`);
        setClouds([]);
      });
  }, [api, projectId]);
  useEffect(reload, [reload, surfacesRevision, volumesRevision]);
  useOnJobsFinished("surface_build", reload);
  useOnJobsFinished("volume_calc", reload);

  const active = measurements?.find((m) => m.id === measurementId) ?? null;
  const ready = useMemo(() => (surfaces ?? []).filter((s) => s.status === "ready"), [surfaces]);
  const readyClouds = useMemo(() => clouds.filter((c) => c.status === "ready"), [clouds]);
  const top =
    (active && surfaces?.find((s) => s.id === active.top_surface_id)) ||
    ready.find((s) => s.id === pickedSurface) ||
    ready[0] ||
    null;
  const baseSurface =
    active?.base.kind === "surface" ? (surfaces?.find((s) => s.id === active.base.surface_id) ?? null) : null;
  const gt = top?.geotransform ?? null;
  const onSurface = measurements?.filter((m) => m.top_surface_id === top?.id) ?? [];

  // The masked machines of the open measurement; none when it masks no detection run.
  const masksRuns = !!active && active.masks.detection_run_ids.length > 0;
  const footprints =
    masksRuns && loadedFootprints?.measurementId === active.id ? loadedFootprints.rings : NO_FOOTPRINTS;
  useEffect(() => {
    if (!active || !masksRuns) return;
    let cancelled = false;
    fetchFootprints(api, projectId, active.id)
      .then((f) => {
        if (!cancelled) setLoadedFootprints({ measurementId: active.id, rings: f.items.map((i) => i.ring) });
      })
      .catch((err: unknown) => report("load the machine footprints", err));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, active?.id, active?.masks]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(
    (patch: VolumeMeasurementPatch) => {
      if (!active) return;
      patchVolume(api, projectId, active.id, patch)
        .then((m) => setMeasurements((all) => all?.map((x) => (x.id === m.id ? m : x)) ?? all))
        .catch((err: unknown) => report("save the change", err));
    },
    [api, projectId, active],
  );

  const onRing = useCallback(
    (role: "measure" | "stable" | "exclusion", ring: number[][], id?: string) => {
      if (!top) return;
      if (role === "measure" && !active) {
        createVolume(api, projectId, {
          name: nextName(measurements ?? []),
          polygon_native: ring,
          top_surface_id: top.id,
          base: { kind: "toe_plane" },
        })
          .then((created) => {
            useJobsStore.getState().upsert(created.job);
            setMeasurements((all) => [created.measurement, ...(all ?? [])]);
            navigate(`/p/${projectId}/volumes/${created.measurement.id}`);
            setTool("pan");
          })
          .catch((err: unknown) => report("create the measurement", err));
        return;
      }
      if (!active) return;
      if (role === "measure") save({ polygon_native: ring });
      else if (role === "stable") save({ alignment: { stable_polygon: ring } });
      else {
        const others = active.masks.exclusion_polygons.filter((e) => e.id !== id);
        const mode = active.masks.exclusion_polygons.find((e) => e.id === id)?.mode ?? "patch";
        save({ masks: { exclusion_polygons: [...others, { id: id ?? crypto.randomUUID(), ring, mode }] } });
      }
      setTool((t) => (t === "edit" ? t : "pan"));
    },
    [api, projectId, top, active, measurements, navigate, save],
  );

  useVolumeLayers(olMap, {
    geotransform: gt ?? NO_GT,
    polygon: active?.polygon_native ?? null,
    stable: active?.alignment.stable_polygon ?? null,
    exclusions: active?.masks.exclusion_polygons ?? NO_EXCLUSIONS,
    footprints,
    tool,
    selectedExclusion,
    onDrawn: (role, ring) => onRing(role, ring),
    onEdited: (role, ring, id) => onRing(role, ring, id),
    onSelectExclusion: setSelectedExclusion,
  });

  // The diff is laid on the lattice of the top it was computed on: after the top changed (stale,
  // old results kept) its tiles would land in the wrong place, so there is no cut/fill layer then.
  const diffUrl =
    active?.results && top && active.results.top_surface.id === top.id
      ? volumeDiffTileUrl(baseUrl, token, projectId, active.id, active.results.computed_at)
      : null;
  useDiffLayer(olMap, top, diffOn ? diffUrl : null);

  const lastSample = useRef(0);
  const onPointer = useCallback(
    (px: number, py: number) => {
      if (!top || !gt) return;
      const now = Date.now();
      if (now - lastSample.current < SAMPLE_MS) return;
      lastSample.current = now;
      const [x, y] = pixelToNative(gt, px, py);
      const base = baseSurface
        ? sampleSurface(api, projectId, baseSurface.id, x, y).then((s) => s.z)
        : Promise.resolve(null);
      Promise.all([sampleSurface(api, projectId, top.id, x, y), base])
        .then(([t, b]) => setReadout({ x, y, top: t.z, base: baseSurface ? b : null }))
        .catch(() => setReadout({ x, y, top: null, base: null }));
    },
    [api, projectId, top, gt, baseSurface],
  );

  // "Pick on map" for a flat base: the next click sets z from the top surface.
  useEffect(() => {
    if (!olMap || !picking || !gt || !top) return;
    const onClick = (e: { coordinate: number[] }) => {
      const [x, y] = pixelToNative(gt, e.coordinate[0], -e.coordinate[1]);
      sampleSurface(api, projectId, top.id, x, y)
        .then((s) => {
          if (s.z == null) toast("info", "No surface there; pick a point on the surface.");
          else save({ base: { kind: "flat", z: Number(s.z.toFixed(3)) } });
        })
        .catch((err: unknown) => report("read the height", err))
        .finally(() => setPicking(false));
    };
    olMap.on("singleclick", onClick);
    return () => olMap.un("singleclick", onClick);
  }, [olMap, picking, gt, top, api, projectId, save]);

  const deleteSelected = useCallback(() => {
    if (!active || !selectedExclusion) return;
    save({
      masks: {
        exclusion_polygons: active.masks.exclusion_polygons.filter((e) => e.id !== selectedExclusion),
      },
    });
    setSelectedExclusion(null);
  }, [active, selectedExclusion, save]);

  if (surfaces && measurements && surfaces.length === 0 && !building) {
    return (
      <EmptyState
        className="h-full p-6"
        icon="volume"
        title={readyClouds.length ? "Build a surface from a point cloud" : "Import a point cloud first"}
        action={
          <>
            {readyClouds.length ? (
              <Button variant="primary" icon="plus" onClick={() => setBuilding({})}>
                Build surface
              </Button>
            ) : (
              <Button variant="primary" onClick={() => navigate(`/p/${projectId}/clouds`)}>
                Go to Point clouds
              </Button>
            )}
            <ImportDesignButton projectId={projectId} onChanged={reload} />
          </>
        }
      >
        A surface is a height grid built from a point cloud. Draw a polygon on it to measure a stockpile or a
        work area.
      </EmptyState>
    );
  }

  const orthoUrl =
    top?.map_id && orthoOn ? surfaceOrthoTileUrl(baseUrl, token, projectId, top.id, top.map_id) : null;
  return (
    <div className="flex h-full min-h-0 w-full">
      <section className="flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line p-3 xl:w-64">
        <h1 className="text-xl font-semibold tracking-tight">Volumes</h1>
        {loadError && (
          <Alert
            tone="danger"
            actions={
              <Button size="sm" icon="refresh" onClick={reload}>
                Retry
              </Button>
            }
          >
            {loadError}
          </Alert>
        )}
        {surfaces && (
          <SurfaceList
            surfaces={surfaces}
            activeId={top?.id ?? null}
            onSelect={(id) => {
              setPickedSurface(id);
              navigate(`/p/${projectId}/volumes`);
            }}
            onBuild={() => setBuilding({})}
            onRebuild={(s) => setBuilding({ cloudId: s.point_cloud_id ?? undefined })}
            onDelete={(s) =>
              void deleteSurface(api, projectId, s.id)
                .then(reload)
                .catch((err: unknown) => report("delete the surface", err))
            }
            actions={<ImportDesignButton projectId={projectId} onChanged={reload} />}
          />
        )}
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Measurements</h2>
            <Button
              size="sm"
              icon="plus"
              disabled={!top}
              aria-label="New measurement"
              title="New measurement (P)"
              onClick={() => {
                navigate(`/p/${projectId}/volumes`);
                setTool("measure");
              }}
            >
              New
            </Button>
          </div>
          {onSurface.length === 0 ? (
            <p className="text-sm text-muted">Draw a polygon around a stockpile or a work area.</p>
          ) : (
            <ul className="flex flex-col gap-1" aria-label="Measurements">
              {onSurface.map((m) => (
                <li key={m.id}>
                  <Button
                    variant={m.id === active?.id ? "secondary" : "ghost"}
                    className="w-full justify-between"
                    onClick={() => navigate(`/p/${projectId}/volumes/${m.id}`)}
                  >
                    <span className="truncate">{m.name}</span>
                    <span className="flex items-center gap-1.5 text-xs tabular-nums text-muted">
                      {headline(m)}
                      <Pill size="sm" tone={STATUS_TONE[m.status]}>
                        {STATUS_TEXT[m.status]}
                      </Pill>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className="relative min-w-0 flex-1 overflow-hidden">
        {top && gt ? (
          <>
            <SurfaceView
              surface={top}
              hillshadeUrl={surfaceTileUrl(baseUrl, token, projectId, top.id)}
              orthoUrl={orthoUrl}
              hillshadeOpacity={orthoUrl ? 0.35 : 1}
              onReady={setOlMap}
              onPointer={onPointer}
              onViewChange={(v) => setResolution(v.resolution)}
            />
            {/* One column for the tools and the layer switches, stopping short of the zoom stack on
                the right: a toolbar that wraps pushes the switches down instead of under them. The
                column itself lets clicks through to the map; only its panels take them. */}
            <div className="pointer-events-none absolute left-3 right-16 top-3 flex flex-col items-start gap-2 [&>*]:pointer-events-auto">
              <VolumeToolbar
                tool={tool}
                onTool={setTool}
                hasMeasurement={!!active}
                onDeleteSelected={deleteSelected}
              />
              {(top.map_id || diffUrl) && (
                <div className="flex flex-col gap-1 rounded-md border border-line bg-panel p-2 shadow-float">
                  {top.map_id && <Switch label="Ortho" checked={orthoOn} onChange={setOrthoOn} />}
                  {diffUrl && <Switch label="Cut / fill" checked={diffOn} onChange={setDiffOn} />}
                </div>
              )}
            </div>
            <SurfaceOverlay map={olMap} surface={top} readout={readout} resolution={resolution} />
          </>
        ) : (
          <EmptyState icon="volume" title="No surface is ready yet">
            A surface appears here when its build has finished.
          </EmptyState>
        )}
      </section>
      <aside
        data-testid="volume-panel"
        className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line p-4 xl:w-80"
      >
        {active && top ? (
          <VolumeAside
            key={active.id}
            projectId={projectId}
            measurement={active}
            top={top}
            surfaces={ready}
            picking={picking}
            onPick={() => setPicking(true)}
            onSave={save}
            onExport={() => setExporting(true)}
            onChanged={reload}
          />
        ) : (
          <p className="text-sm text-muted">Choose a measurement, or draw a polygon with Measure (P).</p>
        )}
      </aside>
      {building && (
        <BuildSurfaceDialog
          projectId={projectId}
          clouds={clouds}
          initialCloudId={building.cloudId}
          onClose={() => setBuilding(null)}
          onStarted={(created) => {
            setBuilding(null);
            setPickedSurface(created.surface.id);
            reload();
          }}
        />
      )}
      {exporting && measurements && (
        <ExportVolumesDialog
          projectId={projectId}
          measurements={measurements}
          preselected={active ? [active.id] : []}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  );
}

function VolumeAside({
  projectId,
  measurement: m,
  top,
  surfaces,
  picking,
  onPick,
  onSave,
  onExport,
  onChanged,
}: {
  projectId: string;
  measurement: VolumeMeasurement;
  top: Surface;
  surfaces: Surface[];
  picking: boolean;
  onPick: () => void;
  onSave: (patch: VolumeMeasurementPatch) => void;
  onExport: () => void;
  onChanged: () => void;
}) {
  const api = useApi();
  const [tab, setTab] = useState<"measure" | "results">(m.results ? "results" : "measure");
  const recalculate = () =>
    calculateVolume(api, projectId, m.id)
      .then((r) => {
        useJobsStore.getState().upsert(r.job);
        onChanged();
      })
      .catch((err: unknown) => report("start the calculation", err));
  // "Revert to last calculated inputs": the one-step undo (section 9).
  const revert = () => {
    const inputs = m.results?.inputs as Partial<VolumeMeasurementPatch> | undefined;
    if (!inputs) return;
    const { polygon_native, top_surface_id, base, masks, alignment } = inputs;
    onSave({ polygon_native, top_surface_id, base, masks, alignment });
  };
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-base font-semibold">{m.name}</h2>
        <Pill tone={STATUS_TONE[m.status]}>{STATUS_TEXT[m.status]}</Pill>
      </div>
      {m.status === "stale" && (
        // The two buttons sit under the notice, not in its actions slot: in a 288 px aside that
        // no-wrap slot squeezed the message itself to zero width.
        <div className="flex flex-col gap-2">
          <Alert tone="warn">{staleText(m.stale_reasons)}</Alert>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => void recalculate()}>
              Recalculate
            </Button>
            <Button size="sm" onClick={revert}>
              Revert to last calculated inputs
            </Button>
          </div>
        </div>
      )}
      <Segmented
        label="Measurement panel"
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: "measure", label: "Measure" },
          { value: "results", label: "Results" },
        ]}
      />
      {tab === "measure" ? (
        <MeasurePanel
          projectId={projectId}
          measurement={m}
          top={top}
          surfaces={surfaces}
          picking={picking}
          onPick={onPick}
          onSave={onSave}
          onChanged={onChanged}
        />
      ) : (
        <VolumeResultsPanel projectId={projectId} measurement={m} top={top} onExport={onExport} />
      )}
    </>
  );
}
