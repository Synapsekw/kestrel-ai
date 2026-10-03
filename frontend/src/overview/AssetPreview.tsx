import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { assetModelGlbUrl } from "@contract/client";
import { useBackend } from "@/api/client";
import { autoProbeSettled } from "@/app/effects";
import { useAssetModel } from "@/assetmodels/useAssetModels";
import type { ModelViewerHandle, ModelViewState } from "@/assetmodels/viewer/ModelViewer";
import { reducedEffects, watchEffects } from "@/clouds/viewer/edl";
import { formatHeight } from "@/findings/format";
import { cx, focusRing, GlassPanel, Skeleton } from "@/ui";
import { AssetStaticCard, assetModelPath } from "./AssetStaticCard";
import { PreviewBoundary } from "./PreviewBoundary";
import { useInView } from "./useInView";

// three loads only when a preview actually starts (as the asset workspace does).
const ModelViewer = lazy(() =>
  import("@/assetmodels/viewer/ModelViewer").then((m) => ({ default: m.ModelViewer })),
);

const noop = () => {};

function Notice({
  projectId,
  modelId,
  text,
  className,
}: {
  projectId: string;
  modelId: string;
  text: string;
  className?: string;
}) {
  return (
    <GlassPanel
      variant="pane"
      className={cx("grid min-h-0 place-items-center gap-2 p-4 text-center", className)}
    >
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-muted">{text}</p>
        <Link
          to={assetModelPath(projectId, modelId)}
          className={cx("rounded-sm text-xs text-accent-ink", focusRing)}
        >
          Open in Asset models
        </Link>
      </div>
    </GlassPanel>
  );
}

/**
 * Spec §9 Overview: the asset hero. The live GLB, auto-rotating, at the cloud hero's size and with
 * its static fallback (spec 2026-09-30-project-landing D5): in view, full effects, probe settled.
 */
export function AssetPreview({
  projectId,
  modelId,
  className,
}: {
  projectId: string;
  modelId: string;
  className?: string;
}) {
  const { baseUrl, token } = useBackend();
  const { model } = useAssetModel(projectId, modelId);
  const [box, inView] = useInView<HTMLDivElement>();
  const key = `${projectId}|${modelId}`;
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [rotatingKey, setRotatingKey] = useState<string | null>(null);
  const failed = failedKey === key;
  const [reduced, setReduced] = useState(reducedEffects);
  const [probeSettled, setProbeSettled] = useState(false);
  const viewer = useRef<ModelViewerHandle>(null);

  useEffect(() => watchEffects(setReduced), []);
  useEffect(() => {
    let live = true;
    // A microtask later, so the Overview's own effect (which starts the probe) has run.
    void Promise.resolve()
      .then(autoProbeSettled)
      .then(() => {
        if (!live) return;
        setReduced(reducedEffects());
        setProbeSettled(true);
      });
    return () => {
      live = false;
    };
  }, []);

  if (model === null)
    return (
      <Notice
        projectId={projectId}
        modelId={modelId}
        text="Couldn't load the asset preview."
        className={className}
      />
    );
  if (model && model.current_version === null)
    return (
      <GlassPanel variant="pane" className={cx("grid min-h-0 place-items-center p-4 text-center", className)}>
        <p className="text-sm text-muted">The asset model is still being built.</p>
      </GlassPanel>
    );

  const version = model?.current_version ?? null;
  const wantLive = Boolean(model) && !reduced && !failed;
  // Until the first intersection callback, or while the probe measures, hold the skeleton.
  const waiting = !model || (wantLive && (inView === null || !probeSettled));
  const liveShown = Boolean(model) && !waiting && wantLive && Boolean(inView) && version !== null;
  const onState = (s: ModelViewState) => {
    if (s === "running") {
      viewer.current?.setAutoRotate(true);
      setRotatingKey(key);
    } else if (s === "no-webgl" || s === "load-error") setFailedKey(key);
  };

  return (
    <GlassPanel
      variant="pane"
      as="section"
      ref={box}
      aria-label="Asset preview"
      aria-busy={waiting || undefined}
      data-rotating={rotatingKey === key && liveShown ? "true" : undefined}
      className={cx("relative min-h-0 overflow-hidden", className)}
    >
      {!model || waiting ? (
        <Skeleton className="absolute inset-0" />
      ) : wantLive && inView && version !== null ? (
        <PreviewBoundary
          key={key}
          what="asset model"
          onError={() => setFailedKey(key)}
          fallback={<AssetStaticCard projectId={projectId} model={model} />}
        >
          <Suspense fallback={<Skeleton className="absolute inset-0" />}>
            {/* ModelViewer's root is `flex-1`: it needs a flex parent, or it renders 0 px tall. */}
            <div className="absolute inset-0 flex">
              <ModelViewer
                ref={viewer}
                glbUrl={assetModelGlbUrl(baseUrl, token, projectId, model.id, version)}
                onParts={noop}
                onSelect={noop}
                onState={onState}
              />
            </div>
            <GlassPanel
              variant="float"
              className="absolute left-3 top-3 z-[2] px-2.5 py-1.5 font-mono text-2xs"
            >
              {model.name}
              {model.frame && ` · ${formatHeight(model.frame.height_m)}`}
            </GlassPanel>
            <Link
              to={assetModelPath(projectId, model.id)}
              className={cx("absolute bottom-3 right-3 z-[2] rounded-sm text-xs text-accent-ink", focusRing)}
            >
              Open in Asset models
            </Link>
          </Suspense>
        </PreviewBoundary>
      ) : (
        <AssetStaticCard projectId={projectId} model={model} />
      )}
    </GlassPanel>
  );
}
