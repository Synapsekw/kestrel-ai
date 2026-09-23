import { useMemo, useState } from "react";
import type { ClassDef, MapRun, MapScore } from "@contract/client";
import { EmptyState, IconButton, Switch } from "@/ui";
import { runTitle } from "./runModel";
import { mistakes, pct, signed } from "./scoreView";

type Row = MapScore["overall"];
type MatchRow = MapScore["matches"][number];

const METRICS: [string, (r: Row) => string][] = [
  ["Precision", (r) => pct(r.precision)],
  ["Recall", (r) => pct(r.recall)],
  ["F1", (r) => pct(r.f1)],
  ["Found / true", (r) => `${r.predicted} / ${r.actual}`],
  ["Count error", (r) => signed(r.count_error)],
];

/**
 * Precision/recall/F1/count-error per selected run, a per-class breakdown, the overlay toggle and
 * mistake stepping. `selected` (tick order) is the single source of truth for which run is primary
 * — the same array `MapsScreen` derives its overlay's `matchOf` from — so the panel can never
 * describe a different run than the map is colouring; `runs` is only consulted to look up a ticked
 * id's display name. The primary is always `selected[0]`, whether or not its score has arrived yet:
 * while it is still loading, its column reads "scoring…"; if the request failed, `scoreErrors`
 * carries why and the column shows that instead of a "scoring…" that would never resolve. Either
 * way the stepper stays disabled rather than silently falling through to a comparison run's numbers.
 */
export function ScorePanel({
  runs,
  selected,
  scores,
  scoreErrors,
  classes,
  overlay,
  onOverlay,
  onStep,
}: {
  runs: MapRun[];
  /** Run ids in tick order (as `RunList`/`toggleCompare` produce them); index 0 is primary. */
  selected: string[];
  scores: Record<string, MapScore | null>;
  /** A run id whose score request failed, mapped to a short reason (`messageOf`). */
  scoreErrors: Record<string, string>;
  classes: ClassDef[];
  overlay: boolean;
  onOverlay: (on: boolean) => void;
  onStep: (m: MatchRow) => void;
}) {
  const runById = (id: string) => runs.find((r) => r.id === id);
  const primaryId = selected[0];
  const secondaryId = selected[1];
  const primaryScore = primaryId !== undefined ? (scores[primaryId] ?? null) : null;
  const secondaryScore = secondaryId !== undefined ? (scores[secondaryId] ?? null) : null;
  const primaryError = primaryId !== undefined ? scoreErrors[primaryId] : undefined;
  const list = useMemo(() => (primaryScore ? mistakes(primaryScore) : []), [primaryScore]);
  const [at, setAt] = useState(-1);
  const name = (id: string) => classes.find((c) => c.id === id)?.name ?? "unknown class";

  if (selected.length === 0) return <p className="text-sm text-muted">Tick a finished run to score it.</p>;
  if (primaryScore && !primaryScore.has_zones) {
    return (
      <EmptyState icon="label" title="Label a zone to score this run">
        Draw a zone on the Labels tab and label every machine inside it; the run is then scored inside it.
      </EmptyState>
    );
  }
  const step = (delta: number) => {
    if (!list.length) return;
    const next = (at + delta + list.length) % list.length;
    setAt(next);
    onStep(list[next]);
  };
  const current = at >= 0 ? list[at] : null;
  const columns = [
    { id: primaryId, score: primaryScore, error: primaryError, run: runById(primaryId) },
    ...(secondaryId !== undefined
      ? [
          {
            id: secondaryId,
            score: secondaryScore,
            error: scoreErrors[secondaryId],
            run: runById(secondaryId),
          },
        ]
      : []),
  ];
  return (
    <section className="flex flex-col gap-4" aria-label="Score">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1 font-medium">
              {primaryScore ? `IoU ≥ ${primaryScore.iou}` : primaryError ? "Could not score" : "Scoring…"}
            </th>
            {columns.map((c) => (
              <th
                key={c.id}
                className="py-1 text-right font-medium"
                title={c.run ? runTitle(c.run) : undefined}
              >
                {c.run?.model_name ?? c.run?.provider ?? "—"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map(([label, fmt]) => (
            <tr key={label} aria-label={label} className="border-t border-line">
              <td className="py-1.5 text-muted">{label}</td>
              {columns.map((c) => (
                <td key={c.id} className="py-1.5 text-right text-ink">
                  {c.score ? (
                    fmt(c.score.overall)
                  ) : c.error ? (
                    <span className="text-danger" title={c.error}>
                      failed
                    </span>
                  ) : (
                    <span className="text-muted">scoring…</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {primaryScore && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Per class</summary>
          <table className="mt-2 w-full tabular-nums">
            <tbody>
              {primaryScore.per_class.map((r) => (
                <tr key={r.class_id} className="border-t border-line">
                  <td className="py-1">{name(r.class_id ?? "")}</td>
                  <td className="py-1 text-right">{pct(r.precision)}</td>
                  <td className="py-1 text-right">{pct(r.recall)}</td>
                  <td className="py-1 text-right">{signed(r.count_error)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <Switch
        checked={overlay}
        onChange={onOverlay}
        label="Colour boxes by result (green right, red false alarm, amber missed)"
      />
      <div className="flex items-center gap-2">
        <IconButton
          icon="chevron-left"
          size="sm"
          label="Previous mistake"
          disabled={!primaryScore || !list.length}
          onClick={() => step(-1)}
        />
        <IconButton
          icon="chevron-right"
          size="sm"
          label="Next mistake"
          disabled={!primaryScore || !list.length}
          onClick={() => step(1)}
        />
        <span className={primaryError ? "text-sm text-danger" : "text-sm text-muted"}>
          {primaryError
            ? `Could not score this run: ${primaryError}`
            : !primaryScore
              ? "Scoring the primary run…"
              : current
                ? `${at + 1} of ${list.length} · ${current.match === "fp" ? "false alarm" : "missed"}: ${name(current.class_id)}`
                : `${list.length} mistakes`}
        </span>
      </div>
    </section>
  );
}
