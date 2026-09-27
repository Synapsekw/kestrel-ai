import { useEffect, useState } from "react";
import type { GeoMap } from "@contract/client";
import { useApi } from "@/api/client";
import { listCloudViews } from "@/api/cloudViews";
import type { PointCloud } from "@/api/clouds";
import { CloudDetails } from "@/clouds/CloudDetails";
import { formatBytes } from "@/clouds/format";
import { Dialog } from "@/ui";

/** "Report views: n · size" (spec §13). Hidden while C-B4's route answers 501, and on any failure. */
function ReportViewsLine({ projectId, cloudId }: { projectId: string; cloudId: string }) {
  const api = useApi();
  const [views, setViews] = useState<{ cloudId: string; n: number; bytes: number } | null>(null);
  useEffect(() => {
    let live = true;
    listCloudViews(api, projectId, cloudId).then(
      (l) => {
        if (live) setViews({ cloudId, n: l.items.length, bytes: l.items.reduce((s, v) => s + v.bytes, 0) });
      },
      () => {
        // 501 until C-B4 merges, or a failure: the line is simply absent.
      },
    );
    return () => {
      live = false;
    };
  }, [api, projectId, cloudId]);
  if (!views || views.cloudId !== cloudId) return null;
  return (
    <p data-testid="cloud-report-views" className="mb-3 text-sm text-muted">
      Report views: {views.n} · {formatBytes(views.bytes)}
    </p>
  );
}

/** S1's CloudDetails in a dialog opened from the cloud picker (spec C12): nothing in it is lost. */
export function CloudDetailsDialog({
  projectId,
  cloud,
  maps,
  exportJobId,
  onExportStarted,
  onChanged,
  onDeleted,
  onClose,
}: {
  projectId: string;
  cloud: PointCloud;
  maps: GeoMap[];
  exportJobId: string | null;
  onExportStarted(jobId: string): void;
  onChanged(c: PointCloud): void;
  onDeleted(): void;
  onClose(): void;
}) {
  return (
    <Dialog open title={cloud.name} description="Details" width="lg" testId="cloud-details" onClose={onClose}>
      <ReportViewsLine projectId={projectId} cloudId={cloud.id} />
      <CloudDetails
        key={cloud.id}
        projectId={projectId}
        cloud={cloud}
        maps={maps}
        exportJobId={exportJobId}
        onExportStarted={onExportStarted}
        onChanged={onChanged}
        onDeleted={onDeleted}
      />
    </Dialog>
  );
}
