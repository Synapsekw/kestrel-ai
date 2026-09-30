import { Link } from "react-router-dom";
import type { PointCloud } from "@/api/clouds";
import { cx, focusRing, Icon } from "@/ui";

export function CloudStaticCard({ projectId, cloud }: { projectId: string; cloud: PointCloud }) {
  const pts = cloud.point_count != null ? `${(cloud.point_count / 1e6).toFixed(1)} M points` : null;
  return (
    <div
      data-testid="cloud-static-card"
      className="grid h-full place-items-center bg-surface-2 p-4 text-center"
    >
      <div className="flex flex-col items-center gap-2">
        <Icon name="cloud" size={28} className="text-muted" />
        <p className="text-sm font-semibold text-ink">{cloud.name}</p>
        <p className="font-mono text-2xs text-muted">
          {[pts, cloud.captured_on].filter(Boolean).join(" · ")}
        </p>
        <Link to={`/p/${projectId}/clouds/${cloud.id}`} className={cx("text-xs text-accent-ink", focusRing)}>
          Open in Point clouds
        </Link>
      </div>
    </div>
  );
}
