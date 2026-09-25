import type { ReactNode } from "react";
import type { Surface } from "@contract/client";
import { useJobsStore } from "@/store/jobs";
import { Button, Pill, Progress, cx, focusRing, transition } from "@/ui";

/**
 * The surfaces of the project (spec section 9): name, kind, cell size, survey date and status with
 * the build's progress. `actions` sits next to "Build surface": S3 mounts its "Import design
 * surface" button there (design-surfaces spec section 11), the only edit S3 makes to this screen.
 */
export function SurfaceList({
  surfaces,
  activeId,
  onSelect,
  onBuild,
  onRebuild,
  onDelete,
  actions,
}: {
  surfaces: Surface[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onBuild: () => void;
  onRebuild: (s: Surface) => void;
  onDelete: (s: Surface) => void;
  actions?: ReactNode;
}) {
  const jobs = useJobsStore((s) => s.jobs);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Surfaces</h2>
        <div className="flex gap-1">
          <Button size="sm" variant="primary" icon="plus" onClick={onBuild}>
            Build surface
          </Button>
          {actions}
        </div>
      </div>
      <ul className="flex flex-col gap-1" aria-label="Surfaces">
        {surfaces.map((s) => {
          const job = s.job_id ? jobs[s.job_id] : undefined;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={s.id === activeId ? "true" : undefined}
                className={cx(
                  "flex w-full flex-col gap-1 rounded-md p-2 text-left",
                  transition,
                  focusRing,
                  s.id === activeId ? "bg-accent-soft" : "hover:bg-hover",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{s.name}</span>
                  <Pill size="sm" tone={s.kind === "design" ? "accent" : "neutral"}>
                    {s.kind === "design" ? "Design" : "From cloud"}
                  </Pill>
                </span>
                {s.status === "building" ? (
                  <Progress value={job?.progress} running label={`Building ${s.name}`} thin />
                ) : s.status === "failed" ? (
                  <Pill tone="danger">Build failed</Pill>
                ) : (
                  <span className="truncate text-xs text-muted">
                    {s.cell_size_m} m cells · {s.captured_on ?? "no survey date"}
                  </span>
                )}
              </button>
              {s.status === "failed" && (
                <div className="flex gap-1 px-2 pb-1">
                  {s.kind === "cloud_dsm" && s.point_cloud_id && (
                    <Button size="sm" icon="refresh" onClick={() => onRebuild(s)}>
                      Build again
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" icon="trash" onClick={() => onDelete(s)}>
                    Delete
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
