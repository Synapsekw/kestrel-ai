import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cloudOctreeUrl, type GeoMap } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { createPointCloud, deletePointCloud, listPointClouds, type PointCloud } from "@/api/clouds";
import { messageOf } from "@/api/errors";
import { listMaps } from "@/api/maps";
import { pushLog } from "@/app/diagnostics";
import { CloudDetails } from "@/clouds/CloudDetails";
import { CloudList } from "@/clouds/CloudList";
import { CloudViewer, type CloudViewerHandle } from "@/clouds/CloudViewer";
import { ImportCloudDialog } from "@/clouds/ImportCloudDialog";
import { ViewPanel, type ViewSettings } from "@/clouds/ViewPanel";
import { readBudget, writeBudget } from "@/clouds/viewer/budget";
import { defaultColour, defaultElevationRange } from "@/clouds/viewer/materialOptions";
import { isTypingTarget } from "@/editor/hotkeys";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, EmptyState, Segmented, toast } from "@/ui";

type Tab = "details" | "view";
const TABS: { value: Tab; label: string }[] = [
  { value: "details", label: "Details" },
  { value: "view", label: "View" },
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
  const { baseUrl, token } = useBackend();
  const viewer = useRef<CloudViewerHandle>(null);
  const [clouds, setClouds] = useState<PointCloud[] | null>(null);
  const [maps, setMaps] = useState<GeoMap[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ path: string; name: string } | null>(null);
  const [tab, setTab] = useState<Tab>("details");
  const [settings, setSettings] = useState<ViewSettings | null>(null);

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
  const defaultRange = useMemo<[number, number]>(
    () => (cloud ? defaultElevationRange(cloud) : [0, 1]),
    [cloud],
  );

  // A new cloud starts from its own defaults; the budget is remembered across clouds.
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  if (cloud && cloud.id !== settingsFor) {
    setSettingsFor(cloud.id);
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
      .then((r) => {
        useJobsStore.getState().upsert(r.job);
        return deletePointCloud(api, projectId, c.id).then(() => {
          reload();
          navigate(`/p/${projectId}/clouds/${r.cloud.id}`);
        });
      })
      .catch((e: unknown) => report("import again", e));

  const remove = (c: PointCloud) =>
    void deletePointCloud(api, projectId, c.id)
      .then(() => {
        reload();
        if (c.id === cloudId) navigate(`/p/${projectId}/clouds`);
      })
      .catch((e: unknown) => report("delete the point cloud", e));

  if (clouds && clouds.length === 0 && !importing) {
    return (
      <div className="flex h-full flex-col p-6">
        <h1 className="text-xl font-semibold tracking-tight">Point clouds</h1>
        <EmptyState
          className="m-auto"
          icon="cloud"
          title="Import a LAS or LAZ point cloud"
          action={
            <Button variant="primary" icon="import" onClick={() => setImporting({ path: "", name: "" })}>
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
          <Button size="sm" icon="import" onClick={() => setImporting({ path: "", name: "" })}>
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
      </section>
      <aside
        data-testid="cloud-panel"
        className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line p-4 xl:w-80"
      >
        {cloud && (
          <>
            <h2 className="min-w-0 truncate text-base font-semibold">{cloud.name}</h2>
            <Segmented label="Cloud panel" size="sm" value={tab} onChange={setTab} options={TABS} />
            {tab === "details" && (
              <CloudDetails
                // Keyed: an error, EPSG draft or export of one cloud never carries over to the next.
                key={cloud.id}
                projectId={projectId}
                cloud={cloud}
                maps={maps}
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
          </>
        )}
      </aside>
      {importing && (
        <ImportCloudDialog
          projectId={projectId}
          initialPath={importing.path}
          initialName={importing.name}
          onClose={() => setImporting(null)}
          onStarted={(c) => {
            setImporting(null);
            reload();
            navigate(`/p/${projectId}/clouds/${c.id}`);
          }}
        />
      )}
    </div>
  );
}
