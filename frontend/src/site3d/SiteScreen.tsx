import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useBackend } from "@/api/client";
import { siteModelUrl, toFrameT, useSiteScene, type SiteScene } from "@/api/siteScene";
import { findingPath } from "@/findings/links";
import { Alert, Button, EmptyState, GlassPanel, Pill, Skeleton, buttonClass } from "@/ui";
import type { SiteEngine } from "./engine/SiteEngine";
import { sceneLayerRows, type ModelState } from "./layerRows";
import { drawingLayerId } from "./layers/drawing.layer";
import { ExtraLayerStatus } from "./layers/ExtraLayerStatus";
import { orthoLayerId } from "./layers/ortho.layer";
import type { PickHit } from "./layers/types";
import { LayersPlaceholder } from "./panels/LayersPlaceholder";
import { useExtraLayerClicks, useSiteExtraLayers } from "./layers/useSiteExtraLayers";
import { SelectionPlaceholder } from "./panels/SelectionPlaceholder";
import { SiteView, type ModelStatus, type SiteViewHandle } from "./SiteView";

const GROUPS = ["model", "ortho", "drawing"] as const;

/** The layer ids behind one of the placeholder's group rows (visibility is kept per layer id). */
function groupIds(scene: SiteScene, row: string): string[] {
  if (row === "ortho") return scene.orthos.map((o) => orthoLayerId(o.id));
  if (row === "drawing") return scene.drawings.map((d) => drawingLayerId(d.id));
  return [row];
}

function BuildLink({ projectId }: { projectId: string }) {
  return (
    <Link to={`/p/${projectId}/models`} className={buttonClass("primary", "md")}>
      Build a plant model
    </Link>
  );
}

/** The Site 3D view, `/p/:projectId/site[/:modelId]` (spec 2026-10-03 §11; S3 replaces the placeholders). */
export function SiteScreen() {
  const { projectId = "", modelId } = useParams();
  const backend = useBackend();
  const { scene, error, errorCode, loading, reload } = useSiteScene(projectId, modelId ?? null);
  const view = useRef<SiteViewHandle>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<PickHit | null>(null);
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [viewFailed, setViewFailed] = useState(false);
  const frame = useMemo(() => (scene ? toFrameT(scene.frame) : null), [scene]);
  const modelUrl = scene?.model
    ? siteModelUrl(backend, projectId, scene.model.id, scene.model.version)
    : null;
  const reported: ModelState = model?.url === modelUrl && model ? model.state : "loading";
  // Ruling R-S1-15: without a running view the model never loads, so it is "Not shown", not "Loading".
  const modelState: ModelState = !modelUrl ? "none" : viewFailed && reported === "loading" ? "off" : reported;
  const items = model?.url === modelUrl ? (model?.info?.items ?? 0) : 0;
  const navigate = useNavigate();
  const [engine, setEngine] = useState<SiteEngine | null>(null);
  // The root that shows for this URL: the new one after a swap, the old one if the swap failed.
  const modelRoot = model?.url === modelUrl ? model.root : null;
  const extra = useSiteExtraLayers({ engine, scene, frame, projectId, modelRoot });
  useExtraLayerClicks(engine, extra, {
    photo: (imageId) => navigate(`/p/${projectId}/images/${encodeURIComponent(imageId)}`),
    finding: (findingId) => navigate(findingPath(projectId, findingId)),
  });

  const toggle = (row: string, visible: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev);
      for (const id of scene ? groupIds(scene, row) : [row]) {
        if (visible) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  // A group row reads as off when every layer in it is hidden.
  const hiddenRows = new Set(
    scene
      ? GROUPS.filter((g) => {
          const ids = groupIds(scene, g);
          return ids.length > 0 && ids.every((id) => hidden.has(id));
        })
      : [],
  );

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
          onSelect={setSelected}
          onModel={setModel}
          onFailure={(kind) => setViewFailed(kind !== null)}
          onEngine={(e) => setEngine(e?.engine ?? null)}
        />
        <ExtraLayerStatus rows={extra.rows} />
        <div className="absolute left-[64px] top-3 z-10">
          <LayersPlaceholder
            rows={sceneLayerRows(scene, modelState, items)}
            hidden={hiddenRows}
            onToggle={toggle}
          />
        </div>
        {selected && (
          <div className="absolute right-3 top-3 z-10">
            <SelectionPlaceholder
              hit={selected}
              onClear={() => {
                view.current?.clearSelection();
                view.current?.focus();
              }}
            />
          </div>
        )}
        {modelState === "none" && (
          <div className="pointer-events-none absolute inset-0 z-[5] grid place-items-center p-6">
            <GlassPanel variant="float" className="pointer-events-auto max-w-sm px-6">
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
        {modelState === "loading" && (
          <div role="status" className="absolute inset-x-0 bottom-6 z-10 mx-auto w-fit">
            <Pill tone="accent" live>
              Loading the plant model
            </Pill>
          </div>
        )}
        {modelState === "error" && !viewFailed && (
          <div className="absolute inset-x-0 bottom-6 z-10 mx-auto w-fit max-w-md px-4">
            <Alert
              tone="danger"
              actions={
                <Button
                  size="sm"
                  icon="refresh"
                  onClick={() => {
                    // Forget the failed load so the retry shows the loading pill (ruling R-S1-24).
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
