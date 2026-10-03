import { useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useBackend } from "@/api/client";
import { absUrl, toFrameT, useSiteScene } from "@/api/siteScene";
import { Alert, Button, EmptyState, GlassPanel, Pill, Skeleton, buttonClass } from "@/ui";
import { sceneLayerRows, type ModelState } from "./layerRows";
import type { PickHit } from "./layers/types";
import { LayersPlaceholder } from "./panels/LayersPlaceholder";
import { SelectionPlaceholder } from "./panels/SelectionPlaceholder";
import { SiteView, type LayerGroup, type ModelStatus, type SiteViewHandle } from "./SiteView";

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
  const { scene, error, loading, reload } = useSiteScene(projectId, modelId ?? null);
  const view = useRef<SiteViewHandle>(null);
  const [hidden, setHidden] = useState<ReadonlySet<LayerGroup>>(() => new Set());
  const [selected, setSelected] = useState<PickHit | null>(null);
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [viewFailed, setViewFailed] = useState(false);
  const frame = useMemo(() => (scene ? toFrameT(scene.frame) : null), [scene]);
  const modelUrl = scene?.model ? absUrl(backend, scene.model.glb_url) : null;
  const reported: ModelState = model?.url === modelUrl && model ? model.state : "loading";
  // Ruling R-S1-15: without a running view the model never loads, so it is "Not shown", not "Loading".
  const modelState: ModelState = !modelUrl ? "none" : viewFailed && reported === "loading" ? "off" : reported;
  const items = model?.url === modelUrl ? (model?.info?.items ?? 0) : 0;

  const toggle = (id: string, visible: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(id as LayerGroup);
      else next.add(id as LayerGroup);
      return next;
    });

  let body;
  if (loading) {
    body = (
      <div role="status" aria-label="Loading site" className="grid h-full place-items-center">
        <Skeleton className="h-40 w-40 rounded-panel" />
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
          hidden={hidden}
          onSelect={setSelected}
          onModel={setModel}
          onFailure={(kind) => setViewFailed(kind !== null)}
        />
        <div className="absolute left-[64px] top-3 z-10">
          <LayersPlaceholder
            rows={sceneLayerRows(scene, modelState, items)}
            hidden={hidden}
            onToggle={toggle}
          />
        </div>
        {selected && (
          <div className="absolute right-3 top-3 z-10">
            <SelectionPlaceholder hit={selected} onClear={() => view.current?.clearSelection()} />
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
                <Button size="sm" icon="refresh" onClick={() => view.current?.reload()}>
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
