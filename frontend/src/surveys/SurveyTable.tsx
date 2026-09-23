import { Pill } from "@/ui";
import type { Survey, SurveyTimeline } from "@/api/surveys";

/** The change since the previous comparable survey; a class that survey lacked has none. */
function delta(n: number | undefined): string {
  if (n === undefined) return "";
  if (n === 0) return "=";
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * `verified`: "both" shows each count as total (verified), "only" says the counts are verified
 * detections (the timeline was fetched with `verified_only`). Without it, plain totals.
 */
export function SurveyTable({
  timeline,
  verified,
}: {
  timeline: SurveyTimeline;
  verified?: "both" | "only";
}) {
  const rows: Survey[] = [...timeline.surveys].reverse(); // newest first on screen
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted">
          <th className="py-2 font-medium">Survey</th>
          <th className="font-medium">Date</th>
          {timeline.classes.map((c) => (
            <th key={c.id} className="font-medium">
              {c.name}
            </th>
          ))}
          <th className="font-medium">Counted with</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.map_id} className="border-t border-line">
            <td className="py-2 text-ink">{s.map_name}</td>
            <td className="text-muted">
              {s.captured_on ?? "date not set"}
              {s.date_is_import_date && <span className="text-dim"> (import date)</span>}
            </td>
            {timeline.classes.map((c) => (
              <td key={c.id} className="tabular-nums text-ink">
                {verified === "both" && s.counts[c.id] !== undefined
                  ? `${s.counts[c.id]} (${s.verified_counts?.[c.id] ?? 0} verified)`
                  : (s.counts[c.id] ?? "-")}
                <span className="text-muted"> {delta(s.deltas[c.id])}</span>
              </td>
            ))}
            <td>
              {s.state === "ok" ? (
                <span className="text-muted">
                  {s.model_name} at {s.conf}
                </span>
              ) : (
                <Pill tone={s.state === "not_counted" ? "neutral" : "warn"}>
                  {s.state === "not_counted" ? "not counted yet" : s.reason}
                </Pill>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
