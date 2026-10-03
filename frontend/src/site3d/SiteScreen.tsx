import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useBackend } from "@/api/client";
import { siteModelUrl, toFrameT, useSiteScene } from "@/api/siteScene";
import { findingPath } from "@/findings/links";
import { Alert, Button, EmptyState, GlassPanel, IconButton, Skeleton, buttonClass } from "@/ui";
import type { ModelState } from "./layerRows";
import { useExtraLayerClicks, useSiteExtraLayers } from "./layers/useSiteExtraLayers";
import { controlsOf } from "./panels/engineBridge";
import { SitePanels, type SiteModelView } from "./panels/SitePanels";
import { SiteView, type ModelStatus, type SiteEngineInfo, type SiteViewHandle } from "./SiteView";

function BuildLink({ projectId }: { projectId: string }) {
  return (
    <Link to={`/p/${projectId}/models`} className={buttonClass("primary", "md")}>
      Build a plant model
    </Link>
  );
}

/** A version of one model (the view's asked-for version, or the one on screen). */
type ModelVersion = { modelId: string; version: number };

/** The Site 3D view, `/p/:projectId/site[/:modelId]` (spec 2026-10-03 §11): S1's view under S3's panels. */
export function SiteScreen() {
  const { projectId = "", modelId } = useParams();
  const backend = useBackend();
  const { scene, error, errorCode, loading, reload } = useSiteScene(projectId, modelId ?? null);
  const view = useRef<SiteViewHandle>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  /** The view's last model report, with the version its URL is (`of`, from `urls`). */
  const [model, setModel] = useState<(ModelStatus & { of?: ModelVersion }) | null>(null);
  const [viewFailed, setViewFailed] = useState(false);
  const [noModelCard, setNoModelCard] = useState(true);
  const frame = useMemo(() => (scene ? toFrameT(scene.frame) : null), [scene]);

  // The version the view shows: the manifest's, until a saved edit asks for its new one (R-S3-10).
  const sceneModel = scene?.model ?? null;
  const [want, setWant] = useState<ModelVersion | null>(null);
  const version = sceneModel ? (want?.modelId === sceneModel.id ? want.version : sceneModel.version) : null;
  const modelUrl =
    sceneModel && version !== null ? siteModelUrl(backend, projectId, sceneModel.id, version) : null;
  // Which version each asked-for URL is, so a load report says what is on screen.
  const urls = useRef(new Map<string, ModelVersion>());
  useEffect(() => {
    if (modelUrl && sceneModel && version !== null)
      urls.current.set(modelUrl, { modelId: sceneModel.id, version });
  }, [modelUrl, sceneModel, version]);
  const [shown, setShown] = useState<ModelVersion | null>(null);
  const onModel = (s: ModelStatus) => {
    const v = urls.current.get(s.url);
    setModel({ ...s, of: v });
    if (s.state === "ready" && v) setShown(v);
  };

  const reported: ModelState = model?.url === modelUrl && model ? model.state : "loading";
  // Ruling R-S1-15: without a running view the model never loads, so it is "Not shown", not "Loading".
  const modelState: ModelState = !modelUrl ? "none" : viewFailed && reported === "loading" ? "off" : reported;
  const shownVersion = sceneModel && shown?.modelId === sceneModel.id ? shown.version : null;
  const modelView: SiteModelView = {
    version,
    shown: shownVersion,
    state: modelState,
    items: model?.url === modelUrl ? (model?.info?.items ?? 0) : 0,
    error: model?.url === modelUrl ? (model?.error ?? null) : null,
  };

  const navigate = useNavigate();
  const [engineInfo, setEngineInfo] = useState<SiteEngineInfo | null>(null);
  const engine = engineInfo?.engine ?? null;
  const modelLayer = engineInfo?.model ?? null;
  const controls = useMemo(
    () => (engine && modelLayer ? controlsOf(engine, modelLayer) : null),
    [engine, modelLayer],
  );
  // The root on screen (R-S3-29): the new one after a swap, the old one while a swap loads or after
  // it failed; null when the report is for another model.
  const modelRoot = model && sceneModel && model.of?.modelId === sceneModel.id ? model.root : null;
  const extra = useSiteExtraLayers({ engine, scene, frame, projectId, modelRoot });
  useExtraLayerClicks(engine, extra, {
    photo: (imageId) => navigate(`/p/${projectId}/images/${encodeURIComponent(imageId)}`),
    finding: (findingId) => navigate(findingPath(projectId, findingId)),
  });

  let body;
  if (loading) {
    body = (
      <div role="status" aria-label="Loading site" className="grid h-full place-items-center">
        <Skeleton className="h-40 w-40 rounded-panel" />
      </div>
    );
  } else if (!scene && modelId && errorCode === "not_found") {
    body = (
      <div className="grid h-full place-items-center p-6">
        <Alert
          tone="warn"
          title="This plant model is not in the project."
          actions={
            <Link to={`/p/${projectId}/site`} className={buttonClass("secondary", "sm")}>
              Open the project&apos;s site
            </Link>
          }
        >
          It may have been deleted. The project&apos;s site shows its newest plant model.
        </Alert>
      </div>
    );
  } else if (!scene) {
    body = (
      <div className="grid h-full place-items-center p-6">
        <Alert
          tone="danger"
          title="The site could not load."
          actions={
            <Button size="sm" icon="refresh" onClick={reload}>
              Try again
            </Button>
          }
        >
          {error}
        </Alert>
      </div>
    );
  } else if (!frame) {
    body = (
      <EmptyState
        icon="cube"
        title="Nothing to place yet"
        action={<BuildLink projectId={projectId} />}
        className="h-full"
      >
        Import a map, a point cloud or a drawing with coordinates, or build a plant model. They show here in
        3D.
      </EmptyState>
    );
  } else {
    body = (
      <>
        <SiteView
          ref={view}
          scene={scene}
          frame={frame}
          modelUrl={modelUrl}
          hidden={hidden}
          onModel={onModel}
          onFailure={(kind) => setViewFailed(kind !== null)}
          onEngine={setEngineInfo}
          onLayerGone={(id) => setGone((prev) => new Set(prev).add(id))}
        />
        <SitePanels
          projectId={projectId}
          scene={scene}
          frame={frame}
          controls={controls}
          s1Layers={engineInfo?.layers ?? []}
          extra={extra}
          view={modelView}
          onShowVersion={(v) => sceneModel && setWant({ modelId: sceneModel.id, version: v })}
          hidden={hidden}
          onHidden={(id, off) =>
            setHidden((prev) => {
              const next = new Set(prev);
              if (off) next.add(id);
              else next.delete(id);
              return next;
            })
          }
          gone={gone}
        />
        {modelState === "none" && noModelCard && (
          <div className="pointer-events-none absolute inset-0 z-[5] grid place-items-center p-6">
            <GlassPanel variant="float" className="pointer-events-auto relative max-w-sm px-6">
              <IconButton
                icon="x"
                label="Dismiss"
                size="sm"
                className="absolute right-2 top-2"
                onClick={() => setNoModelCard(false)}
              />
              <EmptyState
                icon="cube"
                title="No plant model yet"
                action={<BuildLink projectId={projectId} />}
                className="py-8"
              >
                One run reads the drawings and the point cloud and builds every item of the plant. It shows
                here over the maps and drawings.
              </EmptyState>
            </GlassPanel>
          </div>
        )}
        {/* Nothing on screen: the view offers a reload. A failed swap keeps the old model (SitePanels says it is stale). */}
        {modelState === "error" && !viewFailed && shownVersion === null && (
          <div className="absolute inset-x-0 bottom-6 z-10 mx-auto w-fit max-w-md px-4">
            <Alert
              tone="danger"
              actions={
                <Button
                  size="sm"
                  icon="refresh"
                  onClick={() => {
                    // Forget the failed load so the retry reads as loading (ruling R-S1-24).
                    setModel(null);
                    view.current?.reload();
                  }}
                >
                  Reload view
                </Button>
              }
            >
              The plant model could not load.
            </Alert>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden" data-testid="site-screen">
      <h1 className="sr-only">Site 3D</h1>
      {body}
    </div>
  );
}
