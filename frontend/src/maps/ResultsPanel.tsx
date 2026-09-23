import type { ClassDef, MapRun } from "@contract/client";
import { Checkbox, Field, Segmented } from "@/ui";
import { runTitle } from "./runModel";

export type CountScope = "map" | "view";

export interface ResultsPanelProps {
  runs: MapRun[];
  selected: string[];
  classes: ClassDef[];
  wholeMap: Record<string, Record<string, number>>;
  inView: Record<string, Record<string, number>>;
  inViewTruncated: boolean;
  scope: CountScope;
  onScope: (s: CountScope) => void;
  minConf: number;
  onMinConf: (v: number) => void;
  hidden: ReadonlySet<string>;
  onToggleClass: (classId: string) => void;
}

const fmt = (n: number) => new Intl.NumberFormat("en-GB").format(n).replace(/,/g, " ");

export function ResultsPanel(p: ResultsPanelProps) {
  const shown = p.selected.map((id) => p.runs.find((r) => r.id === id)).filter((r): r is MapRun => !!r);
  const source = p.scope === "map" ? p.wholeMap : p.inView;
  const total = (runId: string) => Object.values(source[runId] ?? {}).reduce((a, b) => a + b, 0);
  return (
    <section className="flex flex-col gap-3" aria-label="Detection results">
      <Segmented
        label="Count"
        size="sm"
        value={p.scope}
        onChange={p.onScope}
        options={[
          { value: "map", label: "Whole map" },
          { value: "view", label: "In view" },
        ]}
      />
      {p.scope === "view" && p.inViewTruncated ? (
        <p className="text-sm text-muted">Zoom in to count what is in view.</p>
      ) : (
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 font-medium">Class</th>
              {shown.map((r, i) => (
                <th key={r.id} className="py-1 text-right font-medium" title={runTitle(r)}>
                  {i === 1 ? "┅ " : "─ "}
                  {r.model_name ?? r.provider}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.classes.map((c) => (
              <tr key={c.id} aria-label={c.name} className="border-t border-line">
                <td className="py-1.5">
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={!p.hidden.has(c.id)}
                      onChange={() => p.onToggleClass(c.id)}
                      aria-label={`Show ${c.name}`}
                    />
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ background: c.colour }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{c.name}</span>
                  </label>
                </td>
                {shown.map((r) => (
                  <td key={r.id} className="py-1.5 text-right text-ink">
                    {fmt(source[r.id]?.[c.id] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
            <tr aria-label="Total" className="border-t border-line-strong font-semibold">
              <td className="py-1.5">Total</td>
              {shown.map((r) => (
                <td key={r.id} className="py-1.5 text-right">
                  {fmt(total(r.id))}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
      <Field
        label="Minimum confidence"
        htmlFor="min-conf"
        hint={`Showing boxes at ${Math.round(p.minConf * 100)} % or more.`}
      >
        <input
          id="min-conf"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={p.minConf}
          onChange={(e) => p.onMinConf(Number(e.target.value))}
          className="accent-accent"
        />
      </Field>
    </section>
  );
}
