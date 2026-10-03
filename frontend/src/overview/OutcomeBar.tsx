import { Link } from "react-router-dom";
import type { ProjectOverview } from "@/api/overview";
import { imagesReviewPath } from "@/images/workspace/entryParams";
import { countLabel } from "@/lib/countLabel";
import { cx, focusRing, transition } from "@/ui";

export type PhotoReviewCounts = NonNullable<ProjectOverview["photo_review"]>;
type Outcome = keyof PhotoReviewCounts;

/** Status tones, not data colours: these are the app's own semantic tokens. */
const OUTCOMES: { key: Outcome; label: string; tone: string }[] = [
  { key: "finding", label: "Finding", tone: "bg-danger" },
  { key: "uncertain", label: "Uncertain", tone: "bg-warn" },
  { key: "none", label: "No finding", tone: "bg-ok" },
  { key: "not_assessed", label: "Not assessed", tone: "bg-dim" },
];

/** Spec §9 Overview: photos by review outcome; each part opens the image browser filtered by it. */
export function OutcomeBar({ projectId, counts }: { projectId: string; counts: PhotoReviewCounts }) {
  const total = OUTCOMES.reduce((n, o) => n + counts[o.key], 0);
  if (total === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-2xs text-muted">Photos by outcome</h3>
      <div aria-hidden className="flex h-2 overflow-hidden rounded-chip bg-surface-2">
        {OUTCOMES.filter((o) => counts[o.key] > 0).map((o) => (
          <span
            key={o.key}
            data-testid="outcome-part"
            className={cx("h-full", o.tone)}
            style={{ flexGrow: counts[o.key] }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {OUTCOMES.map((o) => (
          <li key={o.key}>
            <Link
              to={imagesReviewPath(projectId, o.key)}
              aria-label={`${o.label}: ${countLabel(counts[o.key], "photo", "photos")}`}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-sm text-2xs text-muted hover:text-ink",
                transition,
                focusRing,
              )}
            >
              <span aria-hidden className={cx("h-2 w-2 rounded-full", o.tone)} />
              {o.label}
              <span className="font-mono tabular-nums text-ink">{counts[o.key]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
