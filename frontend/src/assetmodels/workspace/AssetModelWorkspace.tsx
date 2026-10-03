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
import { BuildBar } from "@/assetmodels/run/BuildBar";
import { BuildDialog } from "@/assetmodels/run/BuildDialog";
import { RunProgressCard } from "@/assetmodels/run/RunProgressCard";
import { RunTab } from "@/assetmodels/run/RunTab";
import { stopReasonText } from "@/assetmodels/run/runText";
import { endedEarly, runEndToast, tryAgainOf } from "@/assetmodels/run/runView";
import { useLiveRun } from "@/assetmodels/run/useLiveRun";
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
  claimJobOutcome,
  stagger,
  toast,
  useToolShortcuts,
} from "@/ui";
import { downloadGlb, downloadSpec } from "./download";
import { ModelDetailsDialog } from "./ModelDetailsDialog";
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

/** The model's runs, newest first. A failing read (a 501 from an older backend, say) is "no runs". */
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
  const runs = useMemo(
    () =>
      loaded?.key === key ? [...loaded.runs].sort((a, b) => b.started_at.localeCompare(a.started_at)) : [],
    [loaded, key],
  );
  return { runs, reload };
}

function CentreCard({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 right-[344px] z-10 grid place-items-center p-6">
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
  onDetails(): void;
  onModelChanged(): void;
}

/** The viewer and the glass panels for one asset model (keyed by model id: a switch starts afresh). */
function ModelWorkspace({ projectId, model, models, onNew, onDetails, onModelChanged }: ModelWorkspaceProps) {
  const api = useApi();
  const backend = useBackend();
  const viewer = useRef<ModelViewerHandle>(null);
  const { versions, error: versionsError, reload: reloadVersions } = useVersions(projectId, model.id);
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
  // A viewer that mounts afresh (after a failed or still-building version) starts with nothing hidden,
  // cut or selected: when it is running, it gets what the panels say (the latest render's values).
  const replay = useRef<() => void>(() => {});
  const onState = useCallback(
    (state: ModelViewState) => {
      setView({ url: viewerUrl, state });
      if (state === "running") replay.current();
    },
    [viewerUrl],
  );
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
  // Without a version the inspector opens on the Run tab (the parts and versions are still empty).
  const [firstTab, setFirstTab] = useState<ModelInspectorTab>("run");
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
  const { runs, reload: reloadRuns } = useRuns(projectId, model.id);

  // The live run. Once this screen has seen a run running (or started it) it keeps following that run
  // to its end, even after a model reload has cleared `live_run_id`: the end must be seen to be
  // reported. It hands over to the model's `live_run_id` only when that names another run and the
  // followed run's end has been reported.
  const [started, setStarted] = useState<AssetModelRun | null>(null);
  const [followedId, setFollowedId] = useState<string | null>(null);
  const [reportedId, setReportedId] = useState<string | null>(null);
  const handOver =
    model.live_run_id !== null &&
    followedId !== null &&
    model.live_run_id !== followedId &&
    reportedId === followedId;
  const liveRunId = handOver ? model.live_run_id : (followedId ?? model.live_run_id);
  const live = useLiveRun(projectId, model.id, liveRunId);
  // The start answer stands in until the first poll, never over a poll that gave up (the error shows).
  const liveRun = live.run ?? (!live.error && started && started.id === liveRunId ? started : null);
  const runningRun = liveRun?.state === "running" ? liveRun : null;
  if (runningRun && runningRun.id !== followedId) setFollowedId(runningRun.id);
  /** Runs seen running here: only their end gets this screen's toast (not a run already over on load). */
  const seenRunning = useRef(new Set<string>());
  /**
   * Job outcome claims (run id → release) for runs this screen follows: the screen's own toast names
   * the version, so the global job toast stays quiet. A run whose end was reported keeps its claim; one
   * still running when the screen goes, or whose progress can no longer be read, releases it, so the
   * global toast reports it instead.
   */
  const claims = useRef(new Map<string, () => void>());
  const follow = useCallback((r: AssetModelRun) => {
    seenRunning.current.add(r.id);
    if (!claims.current.has(r.id)) claims.current.set(r.id, claimJobOutcome(r.job_id));
  }, []);
  useEffect(() => {
    const held = claims.current;
    return () => {
      for (const release of held.values()) release();
      held.clear();
    };
  }, []);
  useEffect(() => {
    if (!live.error || !liveRunId) return;
    claims.current.get(liveRunId)?.();
    claims.current.delete(liveRunId);
  }, [live.error, liveRunId]);
  useEffect(() => {
    if (!liveRun) return;
    if (liveRun.state === "running") {
      follow(liveRun);
      return;
    }
    if (!seenRunning.current.delete(liveRun.id)) return;
    claims.current.delete(liveRun.id);
    const { tone, text } = runEndToast(liveRun);
    toast(tone, text);
    reloadVersions();
    reloadRuns();
    onModelChanged();
    // After this commit: the hand-over must never drop the ended run before this effect has seen it.
    const id = liveRun.id;
    queueMicrotask(() => setReportedId(id));
  }, [liveRun, follow, reloadVersions, reloadRuns, onModelChanged]);
  const onRunStarted = (r: AssetModelRun) => {
    setStarted(r);
    setFollowedId(r.id);
    follow(r);
    reloadRuns();
  };
  const [retry, setRetry] = useState<{ run: AssetModelRun; key: number } | null>(null);
  const stopLiveRun = () => {
    live.stop().catch((e: unknown) => toast("danger", messageOf(e, "The run could not be stopped.")));
  };
  // The latest ended run: the bar (or, without a version, the centre card) says why it stopped and offers Try again.
  const lastEnded = (liveRun && liveRun.state !== "running" ? liveRun : null) ?? runs[0] ?? null;
  const buildBar = (withTryAgain: boolean) => (
    <BuildBar
      projectId={projectId}
      model={model}
      onStarted={onRunStarted}
      run={runningRun}
      onStop={stopLiveRun}
      stopping={live.stopping}
      lastRun={withTryAgain ? lastEnded : null}
      loading={liveRunId !== null && !liveRun && !live.error}
      error={live.error}
    />
  );
  // The Run tab shows the live run as polled, ahead of the list's copy.
  const tabRuns = useMemo(() => {
    if (!liveRun) return runs;
    const rest = runs.filter((r) => r.id !== liveRun.id);
    return [liveRun, ...rest].sort((a, b) => b.started_at.localeCompare(a.started_at));
  }, [runs, liveRun]);

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
  /** The points last sent to the viewer, replayed onto a fresh one. */
  const overlayPoints = useRef<Float32Array | null>(null);
  const showOverlay = (points: Float32Array | null) => {
    overlayPoints.current = points;
    viewer.current?.setOverlay(points);
  };
  const overlayCloud = comparison?.cloud_id ?? null;
  const overlayRunId = overlayRun?.id ?? null;
  useEffect(() => {
    if (!overlayOn || !overlayRunId || !overlayCloud) {
      showOverlay(null);
      return;
    }
    const key = `${overlayRunId}/${overlayCloud}`;
    if (overlayCache.current.has(key)) {
      showOverlay(overlayCache.current.get(key) ?? null);
      return;
    }
    let live = true;
    // At most 300 000 points (3.6 MB), fetched once per run and cloud and kept for the session.
    // The viewer draws a budgeted subset, not this whole buffer, on each frame.
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
          if (live) showOverlay(points);
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
  useEffect(() => {
    replay.current = () => {
      const v = viewer.current;
      if (!v) return;
      for (const g of hiddenGroups) v.setGroupVisible(g, false);
      v.setCut(tools.cut ? bearing : null);
      v.setLevels(tools.levels);
      v.setHeadOff(tools.headOff);
      v.setOverlay(overlayPoints.current);
      if (selected) v.select(selected);
    };
  });

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
      onDetails={onDetails}
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
        {runningRun ? (
          <RunProgressCard projectId={projectId} model={model} run={runningRun} />
        ) : (
          <CentreCard testId="model-no-version" title="No version yet">
            {lastEnded && endedEarly(lastEnded) ? (
              <>
                <p className="text-sm text-muted">
                  <span className="text-ink">{stopReasonText(lastEnded)}</span>. The last run saved no
                  version; try it again with the same sources and notes, or build with others.
                </p>
                <div>
                  <Button
                    variant="primary"
                    size="sm"
                    icon="refresh"
                    onClick={() => setRetry((r) => ({ run: lastEnded, key: (r?.key ?? 0) + 1 }))}
                  >
                    Try again
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">
                {model.name} has no 3D model yet. Each build or edit saves a version, and the first one opens
                here.
              </p>
            )}
          </CentreCard>
        )}
        <div
          data-testid="model-build-slot"
          className="pointer-events-none absolute bottom-3.5 left-[72px] right-[358px] z-10"
        >
          {buildBar(false)}
        </div>
        {/* The Run tab follows a first build; the parts and versions fill once it saves a version. */}
        <ModelInspector
          tab={firstTab}
          onTab={setFirstTab}
          partsCount={0}
          versionsCount={0}
          partsTab={<PartsTab parts={[]} error={null} selected={null} onSelect={() => {}} />}
          partTab={
            <EmptyState icon="cube" title="No parts yet">
              The first version&apos;s parts can be picked here.
            </EmptyState>
          }
          versionsTab={
            <VersionsTab
              projectId={projectId}
              modelId={model.id}
              versions={[]}
              current={null}
              shown={null}
              onShow={setPicked}
              onRestore={restore}
              error={null}
              onRetry={reloadVersions}
            />
          }
          runTab={<RunTab projectId={projectId} model={model} runs={tabRuns} onStarted={onRunStarted} />}
        />
        {retry && (
          <BuildDialog
            key={retry.key}
            open
            projectId={projectId}
            model={model}
            {...tryAgainOf(retry.run, model.current_version != null)}
            onClose={() => setRetry(null)}
            onStarted={(r) => {
              setRetry(null);
              onRunStarted(r);
            }}
          />
        )}
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
              onSelect: () => {
                if (shown === null) return;
                downloadGlb(backend, projectId, model, shown).catch(() =>
                  toast("danger", "The 3D model could not be downloaded."),
                );
              },
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
            error={versionsError}
            onRetry={reloadVersions}
          />
        }
        runTab={<RunTab projectId={projectId} model={model} runs={tabRuns} onStarted={onRunStarted} />}
      />
      {/* The strip lets the pointer through to the view; the bar takes it back on itself. */}
      <div
        data-testid="model-build-slot"
        className="pointer-events-none absolute bottom-3.5 left-[72px] right-[358px] z-10"
      >
        {buildBar(true)}
      </div>
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  // A deleted model leaves the list at once, before the reload confirms it, so a redirect never lands on it.
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(() => new Set());
  // The list learns of a new model before the navigation that depends on it; the reload confirms it.
  const all = useMemo(() => {
    const listed =
      models && created && !models.some((m) => m.id === created.id) ? [...models, created] : models;
    return listed?.filter((m) => !deleted.has(m.id)) ?? null;
  }, [models, created, deleted]);
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
  const details = detailsOpen && model && (
    <ModelDetailsDialog
      projectId={projectId}
      model={model}
      onClose={() => setDetailsOpen(false)}
      onSaved={(m) => {
        setDetailsOpen(false);
        if (created?.id === m.id) setCreated(m);
        toast("ok", "Saved the details");
        reload();
      }}
      onDeleted={(m) => {
        setDetailsOpen(false);
        setDeleted((d) => new Set(d).add(m.id));
        toast("ok", `Deleted ${m.name}`);
        reload();
        navigate(`/p/${projectId}/models`);
      }}
    />
  );
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
            onDetails={() => setDetailsOpen(true)}
            onModelChanged={reload}
          />
        ) : (
          <MissingModel projectId={projectId} first={all[0]} />
        )}
      </div>
      {dialog}
      {details}
    </div>
  );
}
