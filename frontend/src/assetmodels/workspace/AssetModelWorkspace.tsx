import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  assetModelGlbUrl,
  assetModelOverlayUrl,
  type AssetModel,
  type AssetModelRun,
  type AssetSpec,
} from "@contract/client";
import { createVersion, listRuns, restoreVersion } from "@/api/assetModels";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { groupParts } from "@/assetmodels/groups";
import { useAssetModelList, useVersionDetail, useVersions } from "@/assetmodels/useAssetModels";
import type { ModelPart, ModelView } from "@/assetmodels/viewer/engine";
import { ModelViewer, type ModelViewerHandle, type ModelViewState } from "@/assetmodels/viewer/ModelViewer";
import { NOTICE_INSET } from "@/clouds/workspace/layout";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import {
  Alert,
  Button,
  EmptyState,
  GlassPanel,
  MenuButton,
  Progress,
  Skeleton,
  stagger,
  toast,
  useToolShortcuts,
} from "@/ui";
import { downloadGlb, downloadSpec } from "./download";
import { ModelInspector, type ModelInspectorTab } from "./ModelInspector";
import { ModelPanel } from "./ModelPanel";
import { NewModelDialog } from "./NewModelDialog";
import { PartTab, type Deviation } from "./PartTab";
import { PartsTab, type ListedPart } from "./PartsTab";
import { VersionsTab } from "./VersionsTab";
import { CutBearing, VIEWS, ViewTools, modelKey, type ViewToolState } from "./ViewTools";

/** The fields of `AssetModelRun.comparison` the workspace reads (the contract types it loosely). */
interface Comparison {
  cloud_id: string;
  parts?: ({ id: string } & Deviation)[];
}
const comparisonOf = (run: AssetModelRun) => run.comparison as unknown as Comparison | null;

/** The notice band: between the model panel and the inspector, below the Download button. */
const NOTICE_STYLE = { left: NOTICE_INSET.left, right: NOTICE_INSET.right, top: NOTICE_INSET.top } as const;

/** The model's runs. Until the runs unit lands the backend answers 501: that, like any failure, is "no runs". */
function useRuns(projectId: string, modelId: string) {
  const api = useApi();
  const [loaded, setLoaded] = useState<{ key: string; runs: AssetModelRun[] } | null>(null);
  const key = `${projectId}/${modelId}`;
  const reload = useCallback(() => {
    void listRuns(api, projectId, modelId).then(
      (runs) => setLoaded({ key, runs }),
      () => setLoaded({ key, runs: [] }),
    );
  }, [api, projectId, modelId, key]);
  useEffect(reload, [reload]);
  useOnJobsFinished("asset_model_run", reload);
  return loaded?.key === key ? loaded.runs : [];
}

function CentreCard({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-6">
      <GlassPanel
        variant="float"
        radius="panel"
        data-testid={testId}
        className="pointer-events-auto flex w-full max-w-md flex-col gap-3 p-5 animate-pop reduce-motion:animate-none"
      >
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {children}
      </GlassPanel>
    </div>
  );
}

function ViewNotice({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="model-notice"
      style={NOTICE_STYLE}
      className="absolute z-[15] rounded-control bg-glass-solid shadow-elev-2"
    >
      {children}
    </div>
  );
}

function PendingNotice({ projectId, jobId }: { projectId: string; jobId: string | null }) {
  const { job } = useTrackedJob(projectId, jobId);
  return (
    <Alert tone="info" title="Building the 3D model…">
      <p className="text-xs text-muted">The parts list works from the spec meanwhile.</p>
      <Progress
        thin
        className="mt-2"
        value={job?.progress ?? undefined}
        running
        label="Building the 3D model"
      />
    </Alert>
  );
}

interface ModelWorkspaceProps {
  projectId: string;
  model: AssetModel;
  models: readonly AssetModel[];
  onNew(): void;
  onModelChanged(): void;
}

/** The viewer and the glass panels for one asset model (keyed by model id: a switch starts afresh). */
function ModelWorkspace({ projectId, model, models, onNew, onModelChanged }: ModelWorkspaceProps) {
  const api = useApi();
  const backend = useBackend();
  const viewer = useRef<ModelViewerHandle>(null);
  const { versions, reload: reloadVersions } = useVersions(projectId, model.id);
  const [picked, setPicked] = useState<number | null>(null);
  const shown = picked ?? model.current_version ?? versions?.[0]?.version ?? null;
  const { detail, error: detailError, reload: reloadDetail } = useVersionDetail(projectId, model.id, shown);
  const row = versions?.find((v) => v.version === shown) ?? null;
  const glbStatus = detail?.glb_status ?? row?.glb_status ?? null;
  const glbUrl =
    shown != null && glbStatus === "ready"
      ? assetModelGlbUrl(backend.baseUrl, backend.token, projectId, model.id, shown)
      : null;
  // While a new version's GLB is being built the last model stays in view; it swaps when ready.
  const [lastReady, setLastReady] = useState<string | null>(null);
  if (glbUrl && glbUrl !== lastReady) setLastReady(glbUrl);
  const viewerUrl = glbUrl ?? (glbStatus === "pending" ? lastReady : null);

  const [view, setView] = useState<{ url: string | null; state: ModelViewState } | null>(null);
  const viewState = view && view.url === viewerUrl ? view.state : null;
  const [viewerParts, setViewerParts] = useState<{ url: string | null; parts: ModelPart[] } | null>(null);
  const onState = useCallback((state: ModelViewState) => setView({ url: viewerUrl, state }), [viewerUrl]);
  const onParts = useCallback((parts: ModelPart[]) => setViewerParts({ url: viewerUrl, parts }), [viewerUrl]);

  // The parts list never depends on the 3D view: without WebGL, a GLB that failed to load or build,
  // or one still being built, it lists the version's spec (Review Focus 5).
  const specParts: ListedPart[] | null = useMemo(
    () =>
      detail?.spec.parts?.map((p) => ({ id: p.id, name: p.name, group: p.group })) ?? (detail ? [] : null),
    [detail],
  );
  const fromSpec = glbStatus !== "ready" || viewState === "no-webgl" || viewState === "load-error";
  const shownViewerParts = viewerParts && viewerParts.url === viewerUrl ? viewerParts.parts : null;
  const parts = fromSpec ? specParts : (shownViewerParts ?? specParts);
  const groups = useMemo(() => (parts ? groupParts([...parts]).map(([g]) => g) : []), [parts]);

  const [hiddenGroups, setHiddenGroups] = useState<ReadonlySet<string>>(() => new Set());
  const onGroup = (group: string, visible: boolean) => {
    setHiddenGroups((h) => {
      const next = new Set(h);
      if (visible) next.delete(group);
      else next.add(group);
      return next;
    });
    viewer.current?.setGroupVisible(group, visible);
  };

  const [tab, setTab] = useState<ModelInspectorTab>("parts");
  const [selected, setSelected] = useState<string | null>(null);
  const selectPart = (id: string) => {
    setSelected(id);
    viewer.current?.select(id);
    setTab("part");
  };
  const onViewerSelect = (id: string | null) => {
    setSelected(id);
    if (id) setTab("part");
  };

  // View aids: the palette and its keys.
  const [tools, setTools] = useState<ViewToolState>({ cut: false, levels: false, headOff: false });
  const [bearing, setBearing] = useState(0);
  const toggle = (t: keyof ViewToolState) => {
    const on = !tools[t];
    setTools((s) => ({ ...s, [t]: on }));
    if (t === "cut") viewer.current?.setCut(on ? bearing : null);
    else if (t === "levels") viewer.current?.setLevels(on);
    else viewer.current?.setHeadOff(on);
  };
  const onBearing = (deg: number) => {
    setBearing(deg);
    if (tools.cut) viewer.current?.setCut(deg);
  };
  const setViewTo = (v: ModelView) => viewer.current?.setView(v);
  const running = viewState === "running";
  useToolShortcuts(
    [
      { shortcut: modelKey("cut"), action: "cut", onTrigger: () => toggle("cut") },
      { shortcut: modelKey("levels"), action: "levels", onTrigger: () => toggle("levels") },
      { shortcut: modelKey("head-off"), action: "head-off", onTrigger: () => toggle("headOff") },
      { shortcut: modelKey("fit"), action: "fit", onTrigger: () => setViewTo("fit") },
      ...VIEWS.map((v) => ({
        shortcut: modelKey(v.action),
        action: v.action,
        onTrigger: () => setViewTo(v.view),
      })),
    ],
    running,
  );

  // Runs: the scan overlay and the Part tab's deviation come from the latest run of this version
  // that compared it with a cloud.
  const runs = useRuns(projectId, model.id);
  const overlayRun = useMemo(
    () =>
      runs
        .filter((r) => r.version === shown && comparisonOf(r)?.cloud_id)
        .sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null,
    [runs, shown],
  );
  const comparison = overlayRun ? comparisonOf(overlayRun) : null;
  const [overlayWanted, setOverlayWanted] = useState(false);
  const overlayOn = overlayWanted && !!overlayRun;
  const overlayCache = useRef(new Map<string, Float32Array | null>());
  const overlayCloud = comparison?.cloud_id ?? null;
  const overlayRunId = overlayRun?.id ?? null;
  useEffect(() => {
    if (!overlayOn || !overlayRunId || !overlayCloud) {
      viewer.current?.setOverlay(null);
      return;
    }
    const key = `${overlayRunId}/${overlayCloud}`;
    if (overlayCache.current.has(key)) {
      viewer.current?.setOverlay(overlayCache.current.get(key) ?? null);
      return;
    }
    let live = true;
    // At most 300 000 points (3.6 MB), fetched once per run and cloud and kept for the session.
    fetch(
      assetModelOverlayUrl(backend.baseUrl, backend.token, projectId, model.id, overlayRunId, overlayCloud),
    )
      .then((r) => {
        if (r.status === 204) return null;
        if (!r.ok) throw new Error(`overlay ${r.status}`);
        return r.arrayBuffer();
      })
      .then(
        (buf) => {
          const points = buf ? new Float32Array(buf, 0, Math.floor(buf.byteLength / 4)) : null;
          overlayCache.current.set(key, points);
          if (live) viewer.current?.setOverlay(points);
        },
        () => {
          if (!live) return;
          setOverlayWanted(false);
          toast("danger", "The scan overlay could not be loaded.");
        },
      );
    return () => {
      live = false;
    };
  }, [overlayOn, overlayRunId, overlayCloud, backend.baseUrl, backend.token, projectId, model.id]);
  const deviation = comparison?.parts?.find((p) => p.id === selected) ?? null;

  // New versions: an edit or a restore starts a GLB job; the notice follows it and the view swaps when it ends.
  const [glbJob, setGlbJob] = useState<{ version: number; jobId: string } | null>(null);
  const pendingJobId = glbStatus === "pending" && glbJob?.version === shown ? glbJob.jobId : null;
  const pendingJob = useJobsStore((s) => (pendingJobId ? (s.jobs[pendingJobId] ?? null) : null));
  const pendingDone = pendingJob ? !isActiveJob(pendingJob) : false;
  useEffect(() => {
    if (!pendingDone) return;
    reloadDetail();
    reloadVersions();
  }, [pendingDone, reloadDetail, reloadVersions]);

  const opened = (version: number, jobId: string) => {
    setGlbJob({ version, jobId });
    setPicked(version);
    reloadVersions();
    onModelChanged();
  };
  const saveVersion = async (spec: AssetSpec, note: string) => {
    const { version, job } = await createVersion(api, projectId, model.id, spec, note);
    useJobsStore.getState().upsert(job);
    toast("ok", `Saved version ${version.version}`);
    opened(version.version, job.id);
  };
  const restore = async (n: number) => {
    try {
      const { version, job } = await restoreVersion(api, projectId, model.id, n);
      useJobsStore.getState().upsert(job);
      toast("ok", `Restored version ${n} as version ${version.version}`);
      opened(version.version, job.id);
    } catch (e) {
      toast("danger", messageOf(e, "The version could not be restored."));
    }
  };

  const noVersion = versions !== null && versions.length === 0 && shown === null;
  const panel = (
    <ModelPanel
      projectId={projectId}
      model={model}
      models={models}
      onNew={onNew}
      groups={groups}
      hiddenGroups={hiddenGroups}
      onGroup={onGroup}
      overlay={versions !== null && versions.length === 0 ? null : overlayOn}
      overlayAvailable={!!overlayRun}
      onOverlay={setOverlayWanted}
    >
      {tools.cut && <CutBearing bearing={bearing} onBearing={onBearing} />}
    </ModelPanel>
  );
  if (noVersion)
    return (
      <>
        {panel}
        <CentreCard testId="model-no-version" title="No version yet">
          <p className="text-sm text-muted">
            {model.name} has no 3D model yet. Each build or edit saves a version, and the first one opens
            here.
          </p>
        </CentreCard>
        <div
          data-testid="model-build-slot"
          className="pointer-events-none absolute bottom-3.5 left-[72px] right-[358px] z-10"
        />
      </>
    );

  const partName = parts?.find((p) => p.id === selected)?.name;
  return (
    <>
      {viewerUrl && (
        <ModelViewer
          ref={viewer}
          glbUrl={viewerUrl}
          onParts={onParts}
          onSelect={onViewerSelect}
          onState={onState}
          noticeInset={NOTICE_STYLE}
        />
      )}
      {!viewerUrl && shown !== null && glbStatus === null && !detailError && (
        <div
          role="status"
          aria-label="Loading the version"
          className="absolute inset-0 grid place-items-center"
        >
          <Skeleton className="h-40 w-40 rounded-panel" />
        </div>
      )}
      {detailError && !detail ? (
        <ViewNotice>
          <Alert
            tone="danger"
            title="This version could not be loaded."
            actions={
              <Button size="sm" icon="refresh" onClick={reloadDetail}>
                Retry
              </Button>
            }
          >
            <p className="text-xs text-muted">{detailError}</p>
          </Alert>
        </ViewNotice>
      ) : glbStatus === "pending" ? (
        <ViewNotice>
          <PendingNotice projectId={projectId} jobId={pendingJobId} />
        </ViewNotice>
      ) : glbStatus === "failed" ? (
        <ViewNotice>
          <Alert tone="danger" title="The 3D model could not be built.">
            <p className="text-xs text-muted">
              The parts list still works from the spec; an edit saves a new version and tries again.
            </p>
          </Alert>
        </ViewNotice>
      ) : null}
      <ViewTools state={tools} disabled={!running} onToggle={toggle} onView={setViewTo} />
      {panel}
      <GlassPanel
        variant="float"
        radius="control"
        style={stagger(2)}
        className="stagger absolute right-[358px] top-3.5 z-10 p-[3px] animate-reveal reduce-motion:animate-none"
      >
        <MenuButton
          label="Download"
          icon="download"
          variant="ghost"
          size="sm"
          items={[
            {
              id: "glb",
              label: "3D model (GLB)",
              disabled: glbStatus !== "ready" || shown === null,
              onSelect: () => shown !== null && downloadGlb(backend, projectId, model, shown),
            },
            {
              id: "spec",
              label: "Spec (JSON)",
              disabled: !detail,
              onSelect: () => detail && downloadSpec(model, detail.version, detail.spec),
            },
          ]}
        />
      </GlassPanel>
      <ModelInspector
        tab={tab}
        onTab={setTab}
        partsCount={parts?.length ?? null}
        versionsCount={versions?.length ?? null}
        partsTab={
          <PartsTab
            parts={parts}
            error={!detail && !parts ? detailError : null}
            selected={selected}
            onSelect={selectPart}
          />
        }
        partTab={
          <PartTab
            key={`${shown}/${selected}`}
            projectId={projectId}
            spec={detail?.spec ?? null}
            partId={selected}
            fallbackName={partName}
            deviation={deviation}
            onSave={saveVersion}
          />
        }
        versionsTab={
          <VersionsTab
            projectId={projectId}
            modelId={model.id}
            versions={versions}
            current={model.current_version}
            shown={shown}
            onShow={setPicked}
            onRestore={restore}
          />
        }
      />
      {/* U7 mounts the Build bar here; empty, it lets the pointer through to the view. */}
      <div
        data-testid="model-build-slot"
        className="pointer-events-none absolute bottom-3.5 left-[72px] right-[358px] z-10"
      />
    </>
  );
}

function NoModels({ onNew }: { onNew(): void }) {
  return (
    <div className="flex h-full flex-col p-6">
      <h1 className="text-xl font-semibold">Asset models</h1>
      <EmptyState
        className="m-auto"
        icon="cube"
        title="Build a 3D model of the asset from its drawings, scans and photos"
        action={
          <Button variant="primary" icon="plus" onClick={onNew}>
            New asset model…
          </Button>
        }
      >
        Browse its parts, correct a dimension and keep every version, then compare it with a scan or hand the
        GLB to a client.
      </EmptyState>
    </div>
  );
}

function MissingModel({ projectId, first }: { projectId: string; first: AssetModel }) {
  const navigate = useNavigate();
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <EmptyState
        icon="cube"
        title="This asset model is not in the project"
        action={
          <Button variant="primary" onClick={() => navigate(`/p/${projectId}/models/${first.id}`)}>
            {`Open ${first.name}`}
          </Button>
        }
      >
        It may have been deleted.
      </EmptyState>
    </div>
  );
}

/**
 * The asset model workspace (M1 spec §8) behind `/p/:projectId/models/:modelId?`: the full-bleed
 * GLB viewer with glass panels, the empty state for a project without models, and a centred card
 * for a model with no version yet.
 */
export function AssetModelWorkspace() {
  const { projectId = "", modelId } = useParams();
  const navigate = useNavigate();
  const { models, error, reload } = useAssetModelList(projectId);
  const [created, setCreated] = useState<AssetModel | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  // The list learns of a new model before the navigation that depends on it; the reload confirms it.
  const all = models && created && !models.some((m) => m.id === created.id) ? [...models, created] : models;
  const dialog = newOpen && (
    <NewModelDialog
      projectId={projectId}
      onClose={() => setNewOpen(false)}
      onCreated={(m) => {
        setNewOpen(false);
        setCreated(m);
        reload();
        navigate(`/p/${projectId}/models/${m.id}`);
      }}
    />
  );
  const onNew = () => setNewOpen(true);

  if (!all)
    return (
      <div className="flex h-full flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold">Asset models</h1>
        {error ? (
          <Alert
            tone="danger"
            actions={
              <Button size="sm" icon="refresh" onClick={reload}>
                Retry
              </Button>
            }
          >
            {error}
          </Alert>
        ) : (
          <Skeleton className="h-10 w-72" />
        )}
      </div>
    );
  if (all.length === 0 && modelId) return <Navigate replace to={`/p/${projectId}/models`} />;
  if (all.length === 0)
    return (
      <>
        <NoModels onNew={onNew} />
        {dialog}
      </>
    );
  if (!modelId) return <Navigate replace to={`/p/${projectId}/models/${all[0].id}`} />;
  const model = all.find((m) => m.id === modelId) ?? null;
  return (
    <div data-testid="model-workspace" className="relative flex h-full min-h-0 w-full">
      <h1 className="sr-only">Asset models</h1>
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-bg">
        {model ? (
          <ModelWorkspace
            key={model.id}
            projectId={projectId}
            model={model}
            models={all}
            onNew={onNew}
            onModelChanged={reload}
          />
        ) : (
          <MissingModel projectId={projectId} first={all[0]} />
        )}
      </div>
      {dialog}
    </div>
  );
}
