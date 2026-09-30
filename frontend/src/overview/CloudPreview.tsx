import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cloudOctreeUrl } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { listPointClouds, type PointCloud } from "@/api/clouds";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { reducedEffects, watchEffects } from "@/clouds/viewer/edl";
import { cx, focusRing, GlassPanel, Skeleton } from "@/ui";
import { CloudStaticCard } from "./CloudStaticCard";
import { useInView } from "./useInView";

export const HERO_BUDGET = 1_000_000;
export const TILE_BUDGET = 300_000;

// three + potree-core load only when a preview actually starts (as the Clouds screen does).
const CloudViewer = lazy(() => import("@/clouds/CloudViewer").then((m) => ({ default: m.CloudViewer })));

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
  const [result, setResult] = useState<{ key: string; cloud: PointCloud | null } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const cloud = result?.key === key ? result.cloud : undefined;
  const failed = failedKey === key;
  const [reduced, setReduced] = useState(reducedEffects);

  useEffect(() => watchEffects(setReduced), []);
  useEffect(() => {
    let live = true;
    listPointClouds(api, projectId)
      .then(
        (all) =>
          live &&
          setResult({ key, cloud: cloudId ? (all.find((c) => c.id === cloudId) ?? null) : newestReady(all) }),
      )
      .catch((e: unknown) => {
        pushLog(`point cloud preview unavailable: ${messageOf(e, String(e))}`);
        if (live) setResult({ key, cloud: null });
      });
    return () => {
      live = false;
    };
  }, [api, projectId, cloudId, key]);

  if (cloud === null)
    // A cloud is counted but none is ready yet (still importing, or failed): say so rather than leave a hole.
    return (
      <GlassPanel variant="pane" className={cx("grid min-h-0 place-items-center p-4 text-center", className)}>
        <p className="text-sm text-muted">The point cloud is still being prepared.</p>
      </GlassPanel>
    );
  const live = cloud && !reduced && !failed;
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
      className={cx("relative min-h-0 overflow-hidden", className)}
    >
      {!cloud ? (
        <Skeleton className="absolute inset-0" />
      ) : live && inView ? (
        <Suspense fallback={<Skeleton className="absolute inset-0" />}>
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
      ) : (
        <CloudStaticCard projectId={projectId} cloud={cloud} />
      )}
    </GlassPanel>
  );
}
