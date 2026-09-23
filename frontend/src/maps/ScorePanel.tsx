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
 * mistake stepping. One run drives the mistake list (the first ticked run); a second run only adds
 * a comparison column to the table.
 */
export function ScorePanel({
  runs,
  scores,
  classes,
  overlay,
  onOverlay,
  onStep,
}: {
  runs: MapRun[];
  scores: Record<string, MapScore | null>;
  classes: ClassDef[];
  overlay: boolean;
  onOverlay: (on: boolean) => void;
  onStep: (m: MatchRow) => void;
}) {
  const shown = runs.filter((r) => scores[r.id]);
  const first = shown[0] ? scores[shown[0].id]! : null;
  const list = useMemo(() => (first ? mistakes(first) : []), [first]);
  const [at, setAt] = useState(-1);
  const name = (id: string) => classes.find((c) => c.id === id)?.name ?? "unknown class";

  if (!first) return <p className="text-sm text-muted">Tick a finished run to score it.</p>;
  if (!first.has_zones) {
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
  return (
    <section className="flex flex-col gap-4" aria-label="Score">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1 font-medium">IoU ≥ {first.iou}</th>
            {shown.map((r) => (
              <th key={r.id} className="py-1 text-right font-medium" title={runTitle(r)}>
                {r.model_name ?? r.provider}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map(([label, fmt]) => (
            <tr key={label} aria-label={label} className="border-t border-line">
              <td className="py-1.5 text-muted">{label}</td>
              {shown.map((r) => (
                <td key={r.id} className="py-1.5 text-right text-ink">
                  {fmt(scores[r.id]!.overall)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Per class</summary>
        <table className="mt-2 w-full tabular-nums">
          <tbody>
            {first.per_class.map((r) => (
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
      <Switch
        checked={overlay}
        onChange={onOverlay}
        label="Colour boxes by result (green right, red false alarm, amber missed)"
      />
      <div className="flex items-center gap-2">
        <IconButton
          icon="arrow-left"
          size="sm"
          label="Previous mistake"
          disabled={!list.length}
          onClick={() => step(-1)}
        />
        <IconButton
          icon="chevron-right"
          size="sm"
          label="Next mistake"
          disabled={!list.length}
          onClick={() => step(1)}
        />
        <span className="text-sm text-muted">
          {current
            ? `${at + 1} of ${list.length} · ${current.match === "fp" ? "false alarm" : "missed"}: ${name(current.class_id)}`
            : `${list.length} mistakes`}
        </span>
      </div>
    </section>
  );
}
