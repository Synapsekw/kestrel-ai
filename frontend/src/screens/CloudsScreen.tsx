import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { cloudOctreeUrl } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { fetchPointCloud, type PointCloud } from "@/api/clouds";
import { messageOf } from "@/api/errors";
import { CloudViewer } from "@/clouds/CloudViewer";
import { readBudget } from "@/clouds/viewer/budget";
import { defaultColour, defaultElevationRange } from "@/clouds/viewer/materialOptions";
import { Alert, EmptyState } from "@/ui";

/** Minimal host for the viewer (plan Task 6); Task 13 builds the full work surface around it.
 * Lazy-loaded (F0's lazyScreens.tsx), so three and potree-core load only on this screen. */
export function CloudsScreen() {
  const { projectId = "", cloudId } = useParams();
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const [cloud, setCloud] = useState<PointCloud | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cloudId) return;
    let live = true;
    fetchPointCloud(api, projectId, cloudId)
      .then((c) => live && setCloud(c))
      .catch((e: unknown) => live && setError(messageOf(e, "could not load the point cloud")));
    return () => {
      live = false;
    };
  }, [api, projectId, cloudId]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <h1 className="border-b border-line px-4 py-2 text-xl font-semibold tracking-tight">Point clouds</h1>
      {!cloudId ? (
        <EmptyState className="m-auto p-6" icon="cloud" title="Import a LAS or LAZ point cloud" />
      ) : (
        <section data-testid="cloud-centre" className="relative flex min-h-0 min-w-0 flex-1">
          {error && <Alert tone="danger">{error}</Alert>}
          {cloud?.status === "ready" && (
            <CloudViewer
              cloud={cloud}
              octreeUrl={cloudOctreeUrl(baseUrl, projectId, cloud.id)}
              token={token}
              budget={readBudget()}
              colour={defaultColour(cloud.has_rgb)}
              elevationRange={defaultElevationRange(cloud)}
              pointSize={1}
            />
          )}
        </section>
      )}
    </div>
  );
}
