import type { Dataset, Job } from "@contract/client";
import { formatLocalDate } from "@/models/modelLabels";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Button, Pill, cx } from "@/ui";

interface Props {
  datasets: Dataset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const SPLIT_LABEL: Record<Dataset["split_method"], string> = {
  by_group: "by group",
  by_tile: "by tile",
  random: "random",
};

/** "Writing" while the job that freezes the dataset runs, "Incomplete" when it failed or was cancelled. */
function DatasetState({ job }: { job: Job | undefined }) {
  if (!job) return null;
  if (isActiveJob(job))
    return (
      <Pill tone="accent" size="sm" live>
        Writing
      </Pill>
    );
  if (job.state === "failed" || job.state === "cancelled")
    return (
      <Pill tone="warn" size="sm">
        Incomplete
      </Pill>
    );
  return null;
}

/** The datasets as selectable rows; a table for assistive technology, cards on screen. */
export function DatasetList({ datasets, selectedId, onSelect }: Props) {
  const jobs = useJobsStore((s) => s.jobs);

  return (
    <ul data-testid="dataset-table" aria-label="Datasets" className="flex flex-col gap-2">
      {datasets.map((d) => {
        const selected = d.id === selectedId;
        return (
          // The name is the focusable control; the row adds click-anywhere for the mouse (M9).
          <li
            key={d.id}
            aria-current={selected ? "true" : undefined}
            onClick={() => onSelect(d.id)}
            className={cx(
              "flex cursor-pointer flex-col gap-1 rounded-lg border bg-panel px-4 py-3 text-sm",
              "transition-[border-color,box-shadow] duration-140 ease-out motion-reduce:transition-none",
              selected ? "border-accent" : "border-line hover:border-line-strong hover:shadow-sm",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Select dataset ${d.name}`}
                onClick={(e) => {
                  // The row has its own click-anywhere handler; without this, a click on the
                  // button would bubble up and call onSelect a second time.
                  e.stopPropagation();
                  onSelect(d.id);
                }}
                className="-mx-2 min-w-0 font-semibold"
              >
                <span className="truncate">{d.name}</span>
              </Button>
              <DatasetState job={d.job_id ? jobs[d.job_id] : undefined} />
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
              <span className="tabular-nums">{d.image_count} images</span>
              <span className="tabular-nums">
                {d.train_count} / {d.val_count} train / val
              </span>
              <span>{SPLIT_LABEL[d.split_method]}</span>
              <span className="tabular-nums">{formatLocalDate(d.created_at)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
