import { Link } from "react-router-dom";
import type { GeoMap } from "@contract/client";
import type { PointCloud } from "@/api/clouds";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { Alert, Button, Pill, Progress, cx, focusRing, transition } from "@/ui";
import { crsLabel, formatBytes, formatPoints } from "./format";

const TONE = { ready: "ok", importing: "accent", failed: "danger" } as const;

function ImportProgress({ projectId, jobId }: { projectId: string; jobId: string }) {
  const { job } = useTrackedJob(projectId, jobId);
  return <Progress thin value={job?.progress ?? 0} running label={job?.message || "importing"} />;
}

export function CloudList({
  projectId,
  clouds,
  maps,
  activeId,
  onImportAgain,
  onDelete,
}: {
  projectId: string;
  clouds: PointCloud[];
  maps: GeoMap[];
  activeId?: string;
  onImportAgain(c: PointCloud): void;
  onDelete(c: PointCloud): void;
}) {
  const mapName = (id: string | null) => maps.find((m) => m.id === id)?.name;
  return (
    <ul className="flex flex-col gap-1" aria-label="Point clouds">
      {clouds.map((c) => (
        <li key={c.id} className="flex flex-col gap-1.5">
          <Link
            to={`/p/${projectId}/clouds/${c.id}`}
            aria-current={c.id === activeId ? "page" : undefined}
            className={cx(
              "flex flex-col gap-0.5 rounded-md p-2 text-xs",
              transition,
              focusRing,
              c.id === activeId ? "bg-accent-soft" : "hover:bg-hover",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium text-ink">{c.name}</span>
              <Pill size="sm" tone={TONE[c.status]}>
                {c.status}
              </Pill>
            </span>
            <span className="tabular-nums text-muted">
              {c.point_count != null ? formatPoints(c.point_count) : "—"} · {formatBytes(c.source_size)}
            </span>
            <span className="text-muted">
              {crsLabel(c)}
              {c.captured_on ? ` · ${c.captured_on}` : ""}
              {mapName(c.map_id) ? ` · ${mapName(c.map_id)}` : ""}
            </span>
          </Link>
          {c.status === "importing" && c.job_id && <ImportProgress projectId={projectId} jobId={c.job_id} />}
          {c.status === "failed" && (
            <Alert
              tone="danger"
              actions={
                <>
                  <Button size="sm" icon="refresh" onClick={() => onImportAgain(c)}>
                    Import again
                  </Button>
                  <Button size="sm" variant="ghost" icon="trash" onClick={() => onDelete(c)}>
                    Delete
                  </Button>
                </>
              }
            >
              {c.error}
            </Alert>
          )}
        </li>
      ))}
    </ul>
  );
}
