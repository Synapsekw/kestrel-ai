import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { cloudOctreeUrl, type GeoMap } from "@contract/client";
import { useBackend } from "@/api/client";
import type { PointCloud } from "@/api/clouds";
import { CloudViewer, type CloudPick, type CloudViewerHandle, type ViewState } from "@/clouds/CloudViewer";
import { ImportCloudDialog } from "@/clouds/ImportCloudDialog";
import { cloudToMapNative, jumpQuery } from "@/clouds/jump";
import { useJumpArrival } from "@/clouds/useJumpArrival";
import { readBudget, writeBudget } from "@/clouds/viewer/budget";
import { reducedEffects } from "@/clouds/viewer/edl";
import { defaultColour, defaultElevationRange } from "@/clouds/viewer/materialOptions";
import type { ColourAvailability } from "@/clouds/viewer/types";
import { ReportViewCard as ReportViewCardView } from "@/clouds/views/ReportViewCard";
import { useViewCapture } from "@/clouds/views/useViewCapture";
import { Alert, Button } from "@/ui";
import { canClip } from "./clipEngine";
import { defaultCloud } from "./cloudActions";
import { CloudDetailsDialog } from "./CloudDetailsDialog";
import { CloudPanel, RenderControls } from "./CloudPanel";
import { composeFeatures } from "./compose";
import { useCamerasFeature } from "./features/cameras";
import { useMeasureFeature } from "./features/measure";
import { usePinsFeature } from "./features/pins";
import { useReportViewsFeature } from "./features/reportViews";
import { Gizmo } from "./ViewGizmo";
import { HintBar } from "./HintBar";
import { Inspector, type InspectorTab, type TabContent } from "./Inspector";
import { NOTICE_INSET } from "./layout";
import { Minimap } from "./SiteMinimap";
import { Palette } from "./Palette";
import { Readout } from "./Readout";
import { LikelyViews as LikelyViewsSeam } from "@/clouds/cameras/LikelyViews";
import { WorkspaceSeamsContext, type WorkspaceSeams } from "./seams";
import { ENTRY, type CloudToolId } from "./tools";
import type { FeatureContext, RenderSettings, TopicContent } from "./types";
import { useClipTool } from "./useClipTool";
import { useCloudExports } from "./useCloudExports";
import { useCloudList } from "./useCloudList";
import { useWorkspaceTool } from "./useWorkspaceTool";
import { FailedCloud, ImportingCloud, MissingCloud, NoClouds } from "./WorkspaceStates";

interface ReadyProps {
  projectId: string;
  cloud: PointCloud;
  clouds: readonly PointCloud[];
  maps: GeoMap[];
  onImport(): void;
  onDetails(): void;
}

const toggle = (s: ReadonlySet<number>, code: number) => {
  const next = new Set(s);
  if (!next.delete(code)) next.add(code);
  return next;
};

/** The viewer and every glass panel for one ready cloud (keyed by cloud id: a switch starts afresh). */
function ReadyWorkspace({ projectId, cloud, clouds, maps, onImport, onDetails }: ReadyProps) {
  const viewer = useRef<CloudViewerHandle>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { baseUrl, token } = useBackend();
  const [viewState, setViewState] = useState<ViewState | null>(null);
  const [v2, setV2] = useState(false);
  const [availability, setAvailability] = useState<ColourAvailability | null>(null);
  const [render, setRender] = useState<RenderSettings>(() => ({
    colour: defaultColour(cloud.has_rgb),
    elevationRange: defaultElevationRange(cloud),
    pointSize: 1,
    budget: readBudget(),
    edl: !reducedEffects(),
  }));
  const [hiddenClasses, setHiddenClasses] = useState<ReadonlySet<number>>(() => new Set());
  const [pointsShown, setPointsShown] = useState<number | null>(null);
  const [pick, setPick] = useState<CloudPick | null>(null);
  const [hover, setHover] = useState<CloudPick | null>(null);
  const [tab, setTab] = useState<InspectorTab>("findings");
  const [activeTool, setActiveTool] = useState<CloudToolId>("orbit");
  const running = viewState === "running";
  const hasView = viewState === "running" || viewState === "lost";
  const clip = useClipTool({ cloud, viewer, running });
  // The octree load applies the whole-site view, so a jump arrival moves only once it has loaded
  // (C-V1 hand-off M3): the cloud is handed over when `onAttributes` has reported the load.
  useJumpArrival(viewer, availability ? cloud : null, location.search);

  const edlRef = useRef(render.edl);
  useEffect(() => {
    edlRef.current = render.edl;
    if (running) viewer.current?.setEdl(render.edl);
  }, [running, render.edl]);
  useEffect(() => {
    if (running) viewer.current?.setClassVisibility(hiddenClasses);
  }, [running, hiddenClasses]);
  // The panels around the canvas were laid out anew: one frame re-sends onFrame's rect (C-V1 M7).
  useEffect(() => {
    if (hasView) viewer.current?.requestRender();
  }, [running, hasView]);

  // seams: R1 and L1 fill these
  const viewCapture = useViewCapture({
    projectId,
    cloudId: cloud.id,
    viewer,
    render: () => ({
      colour_mode: render.colour,
      point_budget: render.budget,
      point_size: render.pointSize,
      clip_box: clip.box,
    }),
  });
  const requestViewCapture: WorkspaceSeams["requestViewCapture"] = viewCapture.requestViewCapture;
  const ReportViewCard: WorkspaceSeams["ReportViewCard"] = ReportViewCardView;
  const LikelyViews: WorkspaceSeams["LikelyViews"] = LikelyViewsSeam;
  // end seams
  const seams = useMemo<WorkspaceSeams>(
    () => ({ requestViewCapture, ReportViewCard, LikelyViews }),
    [requestViewCapture, ReportViewCard, LikelyViews],
  );

  const armRef = useRef<(id: CloudToolId) => void>(() => {});
  const ctx = useMemo<FeatureContext>(
    () => ({
      projectId,
      cloud,
      maps,
      viewer,
      viewState: viewState ?? "starting",
      activeTool,
      search: location.search,
      seams,
      render,
      clipBox: clip.box,
      arm: (id) => armRef.current(id),
      // Task 8 replaces this with the rail.
      showTopic: (id) => {
        if (id === "findings" || id === "measure") setTab(id === "measure" ? "measurements" : "findings");
      },
      restoreClipBox: clip.restore,
    }),
    [projectId, cloud, maps, viewState, activeTool, location.search, seams, render, clip.box, clip.restore],
  );
  const features = composeFeatures([
    useMeasureFeature(ctx),
    usePinsFeature(ctx),
    useCamerasFeature(ctx),
    useReportViewsFeature(ctx),
  ]);
  const tools = [...features.tools, clip.tool];
  const isAvailable = (id: CloudToolId) =>
    id === "orbit" || id === "pan" || (id === "fly" || id === "clip" ? v2 : tools.some((t) => t.id === id));
  const control = useWorkspaceTool({
    active: activeTool,
    setActive: setActiveTool,
    tools,
    viewer,
    enabled: hasView,
    isAvailable,
  });
  useEffect(() => {
    armRef.current = control.arm;
  }, [control.arm]);

  const onViewState = useCallback((s: ViewState) => {
    setViewState(s);
    setV2(canClip(viewer.current));
    // A new engine ("Reload view") starts with the global EDL default: the switch wins.
    if (s === "running") viewer.current?.setEdl(edlRef.current);
  }, []);
  const recentre = useCallback(
    (x: number, y: number) => {
      const v = viewer.current;
      if (!v) return;
      const z = v.pickDown(x, y, 2)?.z ?? cloud.z_stats?.p50 ?? 0;
      const pose = v.currentPose();
      if (!pose) {
        v.lookAt({ x, y, z }, v.stats().cameraDistance || 50);
        return;
      }
      const [px, py, pz] = pose.position;
      const [tx, ty, tz] = pose.target;
      v.goToPose({
        position: [x + px - tx, y + py - ty, z + pz - tz],
        target: [x, y, z],
        up: [0, 0, 1],
        fov_deg: pose.fov_deg,
      });
    },
    [cloud.z_stats],
  );

  const active = control.tool;
  const linkedMap =
    maps.find((m) => m.id === cloud.map_id && m.status === "ready" && m.proj4 && m.geotransform) ?? null;
  const shown = active?.picks ? (hover ?? pick) : pick;
  return (
    <WorkspaceSeamsContext.Provider value={seams}>
      <CloudViewer
        ref={viewer}
        cloud={cloud}
        octreeUrl={cloudOctreeUrl(baseUrl, projectId, cloud.id)}
        token={token}
        budget={render.budget}
        colour={render.colour}
        elevationRange={render.elevationRange}
        pointSize={render.pointSize}
        armed={!!active?.picks}
        onPick={(p) => {
          setPick(p);
          active?.onPick?.(p);
        }}
        onHover={(p) => {
          setHover(p);
          active?.onHover?.(p);
        }}
        onAttributes={setAvailability}
        onViewState={onViewState}
        onPointsShown={(s) => setPointsShown(s.pts)}
        noticeInset={NOTICE_INSET}
      />
      {running && features.layers.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-[5]">
          {features.layers.map((s) => (
            <Fragment key={s.key}>{s.node}</Fragment>
          ))}
        </div>
      )}
      {hasView && (
        <>
          <Palette active={control.active} isAvailable={isAvailable} onArm={control.arm} />
          <HintBar
            entry={ENTRY[control.active]}
            tool={active}
            progress={features.hintProgress}
            onCancel={control.escape}
          />
          <Gizmo viewer={viewer} running={running} />
          <Readout
            cloud={cloud}
            pick={shown}
            onShowOnMap={
              pick && linkedMap
                ? () => {
                    const q = cloudToMapNative(cloud, linkedMap, pick);
                    // The workspace on that map; `at` stays in the map's native CRS (clouds/jump.ts).
                    navigate(`/p/${projectId}/maps?map=${linkedMap.id}&${jumpQuery(q).slice(1)}`);
                  }
                : undefined
            }
          />
          {cloud.bounds_native && (
            <Minimap
              projectId={projectId}
              cloud={cloud}
              map={linkedMap}
              viewer={viewer}
              running={running}
              marks={features.minimap}
              clipBox={clip.box}
              onRecentre={recentre}
            />
          )}
        </>
      )}
      {running && features.floating.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-[12]">
          {features.floating.map((s) => (
            <Fragment key={s.key}>{s.node}</Fragment>
          ))}
        </div>
      )}
      <CloudPanel
        projectId={projectId}
        cloud={cloud}
        clouds={clouds}
        onImport={onImport}
        onDetails={onDetails}
      >
        {hasView && (
          <RenderControls
            cloud={cloud}
            render={render}
            onRender={(r) => {
              if (r.budget !== render.budget) writeBudget(r.budget);
              setRender(r);
            }}
            availability={availability}
            hiddenClasses={hiddenClasses}
            onToggleClass={(code) => setHiddenClasses((h) => toggle(h, code))}
            pointsShown={pointsShown}
          />
        )}
        {features.layersRows.map((s) => (
          <Fragment key={s.key}>{s.node}</Fragment>
        ))}
      </CloudPanel>
      <Inspector
        tab={tab}
        onTab={setTab}
        findings={asTab(features.findings)}
        measurements={asTab(features.measure)}
        findingsMenu={features.findings?.menu ?? []}
      />
    </WorkspaceSeamsContext.Provider>
  );
}

/** Task 8 replaces this with the rail: a topic's list above its detail, as one inspector tab. */
function asTab(t: TopicContent | null): TabContent | null {
  return (
    t && {
      count: t.count,
      body: (
        <>
          {t.list}
          {t.detail}
        </>
      ),
    }
  );
}

/**
 * The point cloud workspace (spec §6, C1) behind `/p/:projectId/clouds/:cloudId?`: the full-bleed
 * viewer with glass panels for a ready cloud, S1's empty state for an empty project, and a centred
 * card for an importing or failed cloud. S1's `?at=&fp=` jump is read by `useJumpArrival`.
 */
export function CloudWorkspace() {
  const { projectId = "", cloudId } = useParams();
  const navigate = useNavigate();
  const { clouds, maps, error, reload, replace, add, remove } = useCloudList(projectId);
  const exports = useCloudExports(projectId);
  const [importing, setImporting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const cloud = clouds?.find((c) => c.id === cloudId) ?? null;
  // The list learns of a new or deleted cloud before the navigation that depends on it; the reload
  // only confirms it later. A delete replaces the history entry: Back never returns to the dead id.
  const opened = (fresh: PointCloud) => {
    add(fresh);
    reload();
    navigate(`/p/${projectId}/clouds/${fresh.id}`);
  };
  const deleted = (id: string) => {
    const rest = (clouds ?? []).filter((c) => c.id !== id);
    remove(id);
    reload();
    navigate(`/p/${projectId}/clouds${rest.length ? `/${defaultCloud(rest).id}` : ""}`, { replace: true });
  };

  const dialogs = (
    <>
      {exports.watchers}
      {importing && (
        <ImportCloudDialog
          projectId={projectId}
          onClose={() => setImporting(false)}
          onStarted={(c) => {
            setImporting(false);
            opened(c);
          }}
        />
      )}
      {detailsOpen && cloud && (
        <CloudDetailsDialog
          projectId={projectId}
          cloud={cloud}
          maps={maps}
          exportJobId={exports.exportFor(cloud.id)}
          onExportStarted={(jobId) => exports.started(jobId, cloud.id)}
          onChanged={replace}
          onDeleted={() => {
            setDetailsOpen(false);
            deleted(cloud.id);
          }}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </>
  );

  if (!clouds)
    return (
      <div className="flex h-full flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold">Point clouds</h1>
        {error && (
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
        )}
        {dialogs}
      </div>
    );
  // An empty project lives on the page layout at /clouds (plan Ruling 2), never at a dead cloud id.
  if (clouds.length === 0 && cloudId) return <Navigate replace to={`/p/${projectId}/clouds`} />;
  if (clouds.length === 0) return <NoClouds onImport={() => setImporting(true)}>{dialogs}</NoClouds>;
  if (!cloudId) return <Navigate replace to={`/p/${projectId}/clouds/${defaultCloud(clouds).id}`} />;

  const onImport = () => setImporting(true);
  const onDetails = () => setDetailsOpen(true);
  return (
    <div data-testid="cloud-workspace" className="relative flex h-full min-h-0 w-full">
      <h1 className="sr-only">Point clouds</h1>
      <div data-testid="cloud-centre" className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-bg">
        {!cloud ? (
          <MissingCloud projectId={projectId} clouds={clouds} />
        ) : cloud.status === "ready" ? (
          <ReadyWorkspace
            key={cloud.id}
            projectId={projectId}
            cloud={cloud}
            clouds={clouds}
            maps={maps}
            onImport={onImport}
            onDetails={onDetails}
          />
        ) : (
          <>
            <CloudPanel
              projectId={projectId}
              cloud={cloud}
              clouds={clouds}
              onImport={onImport}
              onDetails={onDetails}
            />
            {cloud.status === "importing" ? (
              <ImportingCloud projectId={projectId} cloud={cloud} />
            ) : (
              <FailedCloud
                projectId={projectId}
                cloud={cloud}
                onChanged={reload}
                onOpened={opened}
                onDeleted={() => deleted(cloud.id)}
              />
            )}
          </>
        )}
      </div>
      {dialogs}
    </div>
  );
}
