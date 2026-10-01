import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cloudOctreeUrl } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { listPointClouds, type PointCloud } from "@/api/clouds";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { autoProbeSettled } from "@/app/effects";
import { reducedEffects, watchEffects } from "@/clouds/viewer/edl";
import { cx, focusRing, GlassPanel, Skeleton } from "@/ui";
import { CloudStaticCard } from "./CloudStaticCard";
import { useInView } from "./useInView";

export const HERO_BUDGET = 1_000_000;
export const TILE_BUDGET = 300_000;

// three + potree-core load only when a preview actually starts (as the Clouds screen does).
const CloudViewer = lazy(() => import("@/clouds/CloudViewer").then((m) => ({ default: m.CloudViewer })));

/**
 * Catches what the viewer throws past its own no-WebGL fallback (an engine error, a chunk that failed to
 * load), logs it and shows `fallback`, so a broken preview never takes the whole app down.
 */
class PreviewBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    pushLog(`point cloud preview failed: ${error.message}`);
    this.props.onError();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Notice({ projectId, text, className }: { projectId: string; text: string; className?: string }) {
  return (
    <GlassPanel
      variant="pane"
      className={cx("grid min-h-0 place-items-center gap-2 p-4 text-center", className)}
    >
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-muted">{text}</p>
        <Link to={`/p/${projectId}/clouds`} className={cx("rounded-sm text-xs text-accent-ink", focusRing)}>
          Open Point clouds
        </Link>
      </div>
    </GlassPanel>
  );
}

function newestReady(clouds: PointCloud[]): PointCloud | null {
  return (
    clouds
      .filter((c) => c.status === "ready")
      .sort(
        (a, b) =>
          (b.captured_on ?? "").localeCompare(a.captured_on ?? "") ||
          b.created_at.localeCompare(a.created_at),
      )[0] ?? null
  );
}

/** Spec 2026-09-30-project-landing D5: a live, drag-to-orbit preview; a static card when it cannot or should not run. */
export function CloudPreview({
  projectId,
  cloudId,
  variant,
  className,
}: {
  projectId: string;
  cloudId: string | null;
  variant: "hero" | "tile";
  className?: string;
}) {
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const [box, inView] = useInView<HTMLDivElement>();
  // Keyed by what they belong to, so a new project or cloud starts fresh (undefined, not failed).
  const key = `${projectId}|${cloudId ?? ""}`;
  const [result, setResult] = useState<{
    key: string;
    cloud: PointCloud | null;
    /** Why there is no cloud to show: the read failed, or every import failed. */
    why?: "error" | "failed";
  } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const cloud = result?.key === key ? result.cloud : undefined;
  const failed = failedKey === key;
  const [reduced, setReduced] = useState(reducedEffects);
  // The live view waits for Auto's frame probe (spec §4.3), so its load is not measured as slow frames.
  const [probeSettled, setProbeSettled] = useState(false);

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
  useEffect(() => {
    let live = true;
    listPointClouds(api, projectId)
      .then((all) => {
        if (!live) return;
        const found = cloudId ? (all.find((c) => c.id === cloudId) ?? null) : newestReady(all);
        const importFailed =
          !found && all.some((c) => c.status === "failed") && !all.some((c) => c.status === "ready");
        setResult({ key, cloud: found, why: importFailed ? "failed" : undefined });
      })
      .catch((e: unknown) => {
        pushLog(`point cloud preview unavailable: ${messageOf(e, String(e))}`);
        if (live) setResult({ key, cloud: null, why: "error" });
      });
    return () => {
      live = false;
    };
  }, [api, projectId, cloudId, key]);

  if (cloud === null) {
    const why = result?.why;
    if (why === "error")
      return (
        <Notice projectId={projectId} text="Couldn't load the point cloud preview." className={className} />
      );
    if (why === "failed")
      return <Notice projectId={projectId} text="The point cloud import failed." className={className} />;
    // A cloud is counted but none is ready yet (still importing): say so rather than leave a hole.
    return (
      <GlassPanel variant="pane" className={cx("grid min-h-0 place-items-center p-4 text-center", className)}>
        <p className="text-sm text-muted">The point cloud is still being prepared.</p>
      </GlassPanel>
    );
  }
  const wantLive = Boolean(cloud) && !reduced && !failed;
  // Until the first intersection callback, or while the probe measures, hold the skeleton: the static
  // card would flash for a moment before the viewer replaces it.
  const waiting = !cloud || (wantLive && (inView === null || !probeSettled));
  const b = cloud?.bounds_native;
  const elevationRange: [number, number] = cloud?.z_stats
    ? [cloud.z_stats.p1, cloud.z_stats.p99]
    : b && b.length === 6
      ? [b[2], b[5]]
      : [0, 1];

  return (
    <GlassPanel
      variant="pane"
      as="section"
      ref={box}
      aria-label="Point cloud preview"
      aria-busy={waiting || undefined}
      className={cx("relative min-h-0 overflow-hidden", className)}
    >
      {!cloud || waiting ? (
        <Skeleton className="absolute inset-0" />
      ) : wantLive && inView ? (
        <PreviewBoundary
          key={key}
          onError={() => setFailedKey(key)}
          fallback={<CloudStaticCard projectId={projectId} cloud={cloud} />}
        >
          <Suspense fallback={<Skeleton className="absolute inset-0" />}>
            {/* CloudViewer's root is `flex-1`: it needs a flex parent, or it renders 0 px tall. */}
            <div className="absolute inset-0 flex">
              <CloudViewer
                cloud={cloud}
                octreeUrl={cloudOctreeUrl(baseUrl, projectId, cloud.id)}
                token={token}
                budget={variant === "hero" ? HERO_BUDGET : TILE_BUDGET}
                colour={cloud.has_rgb ? "rgb" : "elevation"}
                elevationRange={elevationRange}
                pointSize={1}
                onViewState={(s) => s !== "running" && setFailedKey(key)}
              />
            </div>
            <GlassPanel
              variant="float"
              className="absolute left-3 top-3 z-[2] px-2.5 py-1.5 font-mono text-2xs"
            >
              {cloud.name}
              {cloud.point_count != null && ` · ${(cloud.point_count / 1e6).toFixed(1)} M pts`}
            </GlassPanel>
            <Link
              to={`/p/${projectId}/clouds/${cloud.id}`}
              className={cx("absolute bottom-3 right-3 z-[2] rounded-sm text-xs text-accent-ink", focusRing)}
            >
              Open in Point clouds
            </Link>
          </Suspense>
        </PreviewBoundary>
      ) : (
        <CloudStaticCard projectId={projectId} cloud={cloud} />
      )}
    </GlassPanel>
  );
}
