import { Link } from "react-router-dom";
import type { Activity } from "@/api/findings";
import { relativeTime } from "@/findings/format";
import { findingPath } from "@/findings/links";
import { useNow } from "@/jobs/useNow";
import { GlassPanel, Icon, cx, focusRing, stagger, transition, type IconName } from "@/ui";

const ICON: Record<string, IconName> = {
  "finding.created": "findings",
  "finding.status": "check",
  "finding.severity": "warning",
  "finding.comment": "list",
  "data.imported": "import",
  "job.finished": "jobs",
  "detections.accepted": "sparkle",
};

/** The project's newest events; finding events open the finding. */
export function ActivityFeed({
  projectId,
  items,
  failed,
  bare = false,
}: {
  projectId: string;
  items: Activity[];
  /** The activity read failed: say so in this block only. */
  failed: boolean;
  /** Render without the pane wrapper so it can nest (Status pane). */
  bare?: boolean;
}) {
  const nowMs = useNow(60_000);
  const content = (
    <>
      <h2 id="overview-activity" className="text-xs text-muted">
        Activity
      </h2>
      {failed ? (
        <p className="mt-3 text-sm text-muted">Activity could not be loaded.</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nothing has happened here yet.</p>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {items.map((a, i) => {
            const body = (
              <>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted">
                  <Icon name={ICON[a.kind] ?? "info"} size={14} />
                </span>
                <span className="min-w-0 text-sm">
                  <span className="block text-ink">{a.summary}</span>
                  <span className="mt-0.5 block text-2xs text-muted">{relativeTime(a.at, nowMs)}</span>
                </span>
              </>
            );
            const row = "-mx-1.5 flex gap-2.5 rounded-sm px-1.5 py-1";
            return (
              <li key={a.id} className="stagger animate-rise" style={stagger(8 + i)}>
                {a.kind.startsWith("finding.") && a.subject_id ? (
                  <Link
                    to={findingPath(projectId, a.subject_id)}
                    className={cx(row, "hover:bg-hover", transition, focusRing)}
                  >
                    {body}
                  </Link>
                ) : (
                  <div className={row}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {bare && (
        <Link
          to={`/p/${projectId}/findings`}
          className={cx("mt-2 inline-block rounded-sm px-1 text-xs text-accent-ink", focusRing)}
        >
          All activity →
        </Link>
      )}
    </>
  );
  if (bare) return <section aria-labelledby="overview-activity">{content}</section>;
  return (
    <GlassPanel
      variant="pane"
      as="section"
      aria-labelledby="overview-activity"
      className="stagger animate-rise col-span-12 px-4 py-3.5 lg:col-span-4"
      style={stagger(7)}
    >
      {content}
    </GlassPanel>
  );
}
