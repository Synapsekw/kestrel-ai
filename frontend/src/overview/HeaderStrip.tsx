import { Link } from "react-router-dom";
import type { OverviewSite } from "@/api/overview";
import { AddDataButton } from "@/data/AddDataButton";
import { cx, focusRing, GlassPanel } from "@/ui";
import { formatCoords, type Kpi } from "./kpis";

const SOURCE: Record<string, string> = { map: "from ortho", point_cloud: "from point cloud" };

function sourceLabel(site: OverviewSite): string {
  if (site.source === "images") return `from ~${site.photo_points_total.toLocaleString("en-US")} photos`;
  return site.source ? SOURCE[site.source] : "";
}

/** Row 1 of the Overview: name, where, the figures that are not zero, Add data (spec §5.3). */
export function HeaderStrip({
  projectId,
  name,
  figures,
  site,
}: {
  projectId: string;
  /** Null while the project read is in flight: a shimmer holds the slot, never a placeholder name. */
  name: string | null;
  figures: Kpi[];
  site: OverviewSite | null;
}) {
  return (
    <GlassPanel variant="pane" className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold text-ink">
          {name ?? (
            <>
              <span className="sr-only">Loading project name</span>
              <span
                aria-hidden="true"
                className="inline-block h-5 w-40 animate-shimmer rounded-sm bg-surface-2 align-middle"
              />
            </>
          )}
        </h2>
        {site === null ? null : site.center ? (
          <p className="font-mono text-2xs text-muted">
            {formatCoords(site.center[0], site.center[1])}{" "}
            {sourceLabel(site) && <span className="text-dim">· {sourceLabel(site)}</span>}
          </p>
        ) : (
          <p className="text-2xs text-dim">No location data</p>
        )}
      </div>
      <div className="flex-1" />
      {figures.map((f) => {
        const label = f.id === "data" ? "Images" : f.label;
        const body = (
          <span className="flex flex-col">
            <span
              className={cx(
                "font-mono text-xl tabular-nums",
                f.tone === "danger" ? "text-danger" : "text-ink",
              )}
            >
              {f.value?.toLocaleString("en-US")}
              {f.unit && <span className="ml-0.5 text-xs text-muted">{f.unit}</span>}
            </span>
            <span className="text-2xs text-muted">{label}</span>
          </span>
        );
        return f.href ? (
          <Link key={f.id} to={f.href} className={cx("rounded-sm", focusRing)}>
            {body}
          </Link>
        ) : (
          <span key={f.id}>{body}</span>
        );
      })}
      <AddDataButton projectId={projectId} variant="primary" icon="plus">
        Add data
      </AddDataButton>
    </GlassPanel>
  );
}
