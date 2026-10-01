import { Link } from "react-router-dom";
import type { ClassDef } from "@contract/client";
import type { Finding } from "@/api/findings";
import { FindingThumb } from "@/findings/FindingThumb";
import { findingsListPath } from "@/findings/filters";
import { formatFindingNumber } from "@/findings/format";
import { findingPath } from "@/findings/links";
import { findingLocation } from "@/findings/location";
import { STATUS_LABEL } from "@/findings/status";
import { GlassPanel, Icon, SeverityPill, StatusDot, cx, focusRing, stagger, transition } from "@/ui";

const UNKNOWN_TYPE_COLOUR = "rgb(var(--muted))";

/** The five most recently updated findings; each row opens the canonical finding link (F §9.1). */
export function RecentFindings({
  projectId,
  findings,
  failed,
  total,
  types,
  labels,
  className,
}: {
  projectId: string;
  findings: Finding[];
  /** The list read failed: say so in this block only. */
  failed: boolean;
  total: number;
  types: ReadonlyMap<string, ClassDef>;
  labels: ReadonlyMap<string, string>;
  className?: string;
}) {
  return (
    <GlassPanel
      variant="pane"
      as="section"
      aria-labelledby="overview-recent"
      className={cx("stagger animate-rise flex h-full min-h-0 flex-col overflow-hidden", className)}
      style={stagger(7)}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <h2 id="overview-recent" className="text-base font-semibold text-ink">
          Recent findings
        </h2>
        {total > 0 && (
          <Link
            to={findingsListPath(projectId, { sort: "-updated_at" })}
            aria-label={`View all ${total} findings`}
            className={cx("rounded-sm text-xs text-muted hover:text-ink", transition, focusRing)}
          >
            View all {total} →
          </Link>
        )}
      </div>
      {failed ? (
        <p className="px-4 py-6 text-sm text-muted">Recent findings could not be loaded.</p>
      ) : findings.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">
          No findings yet. Mark a defect in a workspace, or accept an AI detection of a defect type.
        </p>
      ) : (
        <ul aria-label="Recent findings" className="min-h-0 overflow-y-auto">
          {findings.map((f, i) => {
            const t = types.get(f.type_id);
            const loc = findingLocation(f, labels);
            return (
              <li
                key={f.id}
                className="stagger animate-rise border-b border-line last:border-b-0"
                style={stagger(8 + i)}
              >
                <Link
                  to={findingPath(projectId, f.id)}
                  className={cx(
                    "group grid grid-cols-[44px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_16px] items-center gap-3 px-4 py-2 text-sm hover:bg-hover",
                    transition,
                    focusRing,
                  )}
                >
                  <FindingThumb projectId={projectId} finding={f} colour={t?.colour ?? UNKNOWN_TYPE_COLOUR} />
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="truncate font-semibold text-ink">{t?.name ?? "Unknown type"}</span>
                      <span className="shrink-0 font-mono text-2xs text-muted">
                        {formatFindingNumber(f.number)}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {loc.secondary ?? (f.note || loc.primary)}
                    </span>
                  </span>
                  <span>
                    <SeverityPill level={f.severity} />
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                    <Icon name={loc.icon} size={14} className="shrink-0" />
                    <span className="truncate">{loc.primary}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                    <StatusDot status={f.status} />
                    {STATUS_LABEL[f.status]}
                  </span>
                  <Icon
                    name="chevron-right"
                    size={14}
                    className={cx(
                      "text-dim group-hover:translate-x-0.5 group-hover:text-ink reduce-motion:group-hover:translate-x-0",
                      transition,
                    )}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </GlassPanel>
  );
}
