import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { cloudOctreeUrl, type GeoMap } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { createPointCloud, deletePointCloud, listPointClouds, type PointCloud } from "@/api/clouds";
import { messageOf } from "@/api/errors";
import { listMaps } from "@/api/maps";
import { pushLog } from "@/app/diagnostics";
import { CloudDetails } from "@/clouds/CloudDetails";
import { CloudList } from "@/clouds/CloudList";
import { CloudViewer, type CloudPick, type CloudViewerHandle } from "@/clouds/CloudViewer";
import { ExportWatch } from "@/clouds/ExportWatch";
import { ImportCloudDialog } from "@/clouds/ImportCloudDialog";
import { cloudToMapNative, jumpQuery } from "@/clouds/jump";
import { MeasurePanel } from "@/clouds/MeasurePanel";
import { overlayShapes } from "@/clouds/measure";
import { useJumpArrival } from "@/clouds/useJumpArrival";
import { useMeasureTool } from "@/clouds/useMeasureTool";
import { ViewPanel, type ViewSettings } from "@/clouds/ViewPanel";
import { readBudget, writeBudget } from "@/clouds/viewer/budget";
import { defaultColour, defaultElevationRange } from "@/clouds/viewer/materialOptions";
import { isTypingTarget } from "@/editor/hotkeys";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, EmptyState, Segmented, toast } from "@/ui";

type Tab = "details" | "view" | "measure";
const TABS: { value: Tab; label: string }[] = [
  { value: "details", label: "Details" },
  { value: "view", label: "View" },
  { value: "measure", label: "Measure" },
];

function report(action: string, err: unknown): string {
  const message = messageOf(err, `could not ${action}`);
  pushLog(`${action} failed: ${message}`);
  toast("danger", message);
  return message;
}

export function CloudsScreen() {
  const { projectId = "", cloudId } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const { baseUrl, token } = useBackend();
  const viewer = useRef<CloudViewerHandle>(null);
  const [clouds, setClouds] = useState<PointCloud[] | null>(null);
  const [maps, setMaps] = useState<GeoMap[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // Running LAZ exports by cloud id. Held here (always mounted on /clouds) so a tab or cloud switch
  // mid-export still ends in its toast.
  const [exports, setExports] = useState<Record<string, string>>({});
  const exportDone = useCallback(
    (jobId: string) =>
      setExports((e) => Object.fromEntries(Object.entries(e).filter(([, id]) => id !== jobId))),
    [],
  );
  const [tab, setTab] = useState<Tab>("details");
  const [settings, setSettings] = useState<ViewSettings | null>(null);
  const measure = useMeasureTool();
  const { cancel: cancelMeasure } = measure;

  // The overlay follows the tool (an effect that only talks to the viewer, never to React state).
  useEffect(() => {
    viewer.current?.setOverlay(
      "measure",
      tab === "measure" && measure.tool ? overlayShapes(measure.tool, measure.picks, measure.hover) : [],
    );
  }, [tab, measure.tool, measure.picks, measure.hover]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelMeasure();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelMeasure]);

  const reload = useCallback(() => {
    void listPointClouds(api, projectId)
      .then((cs) => {
        setClouds(cs);
        setListError(null);
      })
      .catch((e: unknown) => setListError(report("load point clouds", e)));
    void listMaps(api, projectId)
      .then(setMaps)
      .catch(() => setMaps([]));
  }, [api, projectId]);
  useEffect(reload, [reload]);
  useOnJobsFinished("pointcloud_import", reload);

  const cloud = clouds?.find((c) => c.id === cloudId) ?? null;
  useJumpArrival(viewer, cloud, location.search);
  const [lastPick, setLastPick] = useState<CloudPick | null>(null);
  const defaultRange = useMemo<[number, number]>(
    () => (cloud ? defaultElevationRange(cloud) : [0, 1]),
    [cloud],
  );

  // A new cloud starts from its own defaults; the budget is remembered across clouds. Keyed on the
  // status too: an importing row has no z stats or colour yet, so the ready row seeds again.
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const seedKey = cloud ? `${cloud.id}|${cloud.status}` : null;
  if (cloud && seedKey !== settingsFor) {
    setSettingsFor(seedKey);
    // Picks belong to one cloud's coordinates; a switch puts the tool down.
    if (settingsFor?.split("|")[0] !== cloud.id) {
      measure.cancel();
      setLastPick(null); // "Show on map" never carries one cloud's pick onto another's map
    }
    setSettings({
      budget: readBudget(),
      colour: defaultColour(cloud.has_rgb),
      elevationRange: defaultRange,
      pointSize: 1,
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "f" || e.key === "F") viewer.current?.fit();
      if (e.key === "t" || e.key === "T") viewer.current?.topView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const importAgain = (c: PointCloud) =>
    void createPointCloud(api, projectId, { path: c.source_path, name: c.name })
      .then(
        (r) => {
          useJobsStore.getState().upsert(r.job);
          navigate(`/p/${projectId}/clouds/${r.cloud.id}`);
          // The new import runs either way; a failed delete only leaves the old row in the list.
          return deletePointCloud(api, projectId, c.id).then(
            () => undefined,
            (e: unknown) => void report("remove the failed point cloud", e),
          );
        },
        (e: unknown) => void report("import again", e),
      )
      .finally(reload);

  const remove = (c: PointCloud) =>
    void deletePointCloud(api, projectId, c.id)
      .then(() => {
        reload();
        if (c.id === cloudId) navigate(`/p/${projectId}/clouds`);
      })
      .catch((e: unknown) => report("delete the point cloud", e));

  // Rendered in both layouts: deleting the last cloud mid-export still ends in its toast.
  const watchers = Object.values(exports).map((jobId) => (
    <ExportWatch key={jobId} projectId={projectId} jobId={jobId} onDone={exportDone} />
  ));

  if (clouds && clouds.length === 0 && !importing) {
    return (
      <div className="flex h-full flex-col p-6">
        {watchers}
        <h1 className="text-xl font-semibold tracking-tight">Point clouds</h1>
        <EmptyState
          className="m-auto"
          icon="cloud"
          title="Import a LAS or LAZ point cloud"
          action={
            <Button variant="primary" icon="import" onClick={() => setImporting(true)}>
              Import
            </Button>
          }
        >
          See a drone survey in 3D, measure points, distances and plumbness, and hand a LAZ to a client.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      <section className="flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line p-3 xl:w-64">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Point clouds</h1>
          <Button size="sm" icon="import" onClick={() => setImporting(true)}>
            Import
          </Button>
        </div>
        {clouds ? (
          <CloudList
            projectId={projectId}
            clouds={clouds}
            maps={maps}
            activeId={cloudId}
            onImportAgain={importAgain}
            onDelete={remove}
          />
        ) : (
          listError && (
            <Alert
              tone="danger"
              actions={
                <Button size="sm" icon="refresh" onClick={reload}>
                  Retry
                </Button>
              }
            >
              {listError}
            </Alert>
          )
        )}
      </section>
      <section data-testid="cloud-centre" className="relative flex min-h-0 min-w-0 flex-1">
        {cloud?.status === "ready" && settings ? (
          <CloudViewer
            ref={viewer}
            cloud={cloud}
            octreeUrl={cloudOctreeUrl(baseUrl, projectId, cloud.id)}
            token={token}
            budget={settings.budget}
            colour={settings.colour}
            elevationRange={settings.elevationRange}
            pointSize={settings.pointSize}
            armed={tab === "measure" && !!measure.tool}
            onPick={(p) => {
              setLastPick(p);
              if (tab === "measure") measure.add(p);
            }}
            onHover={measure.setHover}
          />
        ) : (
          <EmptyState
            className="m-auto"
            icon="cloud"
            title={cloud ? `${cloud.name} is ${cloud.status}` : "Choose a point cloud"}
          >
            {cloud?.error ?? "Pick a cloud on the left, or import one."}
          </EmptyState>
        )}
        {(() => {
          const linkedMap = maps.find((m) => m.id === cloud?.map_id && m.proj4 && m.geotransform);
          if (!cloud || !lastPick || !linkedMap) return null;
          return (
            <div className="absolute bottom-10 right-3">
              <Button
                size="sm"
                icon="map"
                onClick={() => {
                  const q = cloudToMapNative(cloud, linkedMap, lastPick);
                  navigate(`/p/${projectId}/maps/${linkedMap.id}${jumpQuery(q)}`);
                }}
              >
                Show on map
              </Button>
            </div>
          );
        })()}
      </section>
      <aside
        data-testid="cloud-panel"
        className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line p-4 xl:w-80"
      >
        {cloud && (
          <>
            <h2 className="min-w-0 truncate text-base font-semibold">{cloud.name}</h2>
            <Segmented
              label="Cloud panel"
              size="sm"
              value={tab}
              onChange={(t) => {
                setTab(t);
                if (t !== "measure") measure.cancel();
              }}
              options={TABS}
            />
            {tab === "details" && (
              <CloudDetails
                // Keyed: an error, EPSG draft or export of one cloud never carries over to the next.
                key={cloud.id}
                projectId={projectId}
                cloud={cloud}
                maps={maps}
                exportJobId={exports[cloud.id] ?? null}
                onExportStarted={(jobId) => setExports((e) => ({ ...e, [cloud.id]: jobId }))}
                onChanged={(c) => setClouds((cs) => cs?.map((x) => (x.id === c.id ? c : x)) ?? cs)}
                onDeleted={() => {
                  reload();
                  navigate(`/p/${projectId}/clouds`);
                }}
              />
            )}
            {tab === "view" && settings && (
              <ViewPanel
                settings={settings}
                hasRgb={!!cloud.has_rgb}
                defaultRange={defaultRange}
                onChange={(s) => {
                  if (s.budget !== settings.budget) writeBudget(s.budget);
                  setSettings(s);
                }}
                onFit={() => viewer.current?.fit()}
                onTop={() => viewer.current?.topView()}
              />
            )}
            {tab === "measure" && (
              <MeasurePanel
                key={cloud.id}
                projectId={projectId}
                cloud={cloud}
                tool={measure}
                onFlyTo={(p) => viewer.current?.lookAt({ x: p.x, y: p.y, z: p.z }, 30)}
              />
            )}
          </>
        )}
      </aside>
      {watchers}
      {importing && (
        <ImportCloudDialog
          projectId={projectId}
          onClose={() => setImporting(false)}
          onStarted={(c) => {
            setImporting(false);
            reload();
            navigate(`/p/${projectId}/clouds/${c.id}`);
          }}
        />
      )}
    </div>
  );
}
