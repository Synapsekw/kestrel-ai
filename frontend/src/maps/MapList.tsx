import { Link } from "react-router-dom";
import { mapPreviewUrl, type GeoMap } from "@contract/client";
import { useBackend } from "@/api/client";
import { useJobsStore } from "@/store/jobs";
import { Pill, Progress, cx, focusRing, transition } from "@/ui";

export function MapList({
  projectId,
  maps,
  activeId,
}: {
  projectId: string;
  maps: GeoMap[];
  activeId?: string;
}) {
  const { baseUrl, token } = useBackend();
  const jobs = useJobsStore((s) => s.jobs);
  return (
    <ul className="flex flex-col gap-1" aria-label="Maps">
      {maps.map((m) => {
        const job = m.job_id ? jobs[m.job_id] : undefined;
        return (
          <li key={m.id}>
            <Link
              to={`/p/${projectId}/maps/${m.id}`}
              aria-current={m.id === activeId ? "page" : undefined}
              className={cx(
                "flex gap-2.5 rounded-md p-2",
                transition,
                focusRing,
                m.id === activeId ? "bg-accent-soft" : "hover:bg-hover",
              )}
            >
              <span className="h-12 w-16 shrink-0 overflow-hidden rounded bg-well">
                {m.status === "ready" && (
                  <img
                    src={mapPreviewUrl(baseUrl, token, projectId, m.id)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm font-medium text-ink">{m.name}</span>
                {m.status === "importing" ? (
                  <Progress value={job?.progress} running label={`Importing ${m.name}`} thin />
                ) : m.status === "failed" ? (
                  <Pill tone="danger">Import failed</Pill>
                ) : (
                  <span className="truncate text-xs text-muted">
                    {m.epsg ? `EPSG:${m.epsg}` : "No coordinates"} ·{" "}
                    {m.gsd_cm ? `${m.gsd_cm.toFixed(1)} cm / px` : `${m.width} × ${m.height} px`}
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
