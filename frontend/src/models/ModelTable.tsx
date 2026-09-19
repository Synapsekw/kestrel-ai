import type { Model } from "@contract/client";
import { Button, Pill, cx } from "@/ui";
import { formatLocalDate, formatMetric, kindLabel } from "./modelLabels";

interface Props {
  models: Model[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const HEADERS: { label: string; className?: string }[] = [
  { label: "Name" },
  { label: "Kind" },
  { label: "Base" },
  { label: "mAP50", className: "text-right" },
  { label: "Created" },
];

/** The registry: one 36px row per model; the name selects it (so does a click anywhere on the row). */
export function ModelTable({ models, selectedId, onSelect }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-panel">
      <table data-testid="model-table" className="w-full border-collapse text-left text-[13px]">
        <thead>
          <tr className="text-xs text-muted">
            {HEADERS.map((h) => (
              <th key={h.label} className={cx("h-8 border-b border-line px-3 font-medium", h.className)}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {models.map((m) => {
            const selected = m.id === selectedId;
            return (
              <tr
                key={m.id}
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(m.id)}
                className={cx(
                  "h-9 cursor-pointer border-b border-line transition-colors duration-140 ease-out last:border-b-0 motion-reduce:transition-none",
                  selected ? "bg-well" : "hover:bg-hover",
                )}
              >
                <td className="px-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Select model ${m.name}`}
                    onClick={() => onSelect(m.id)}
                    className="font-semibold"
                  >
                    {m.name}
                  </Button>
                </td>
                <td className="px-3">
                  <Pill tone={m.kind === "trained" ? "ok" : "neutral"} size="sm">
                    {kindLabel(m.kind)}
                  </Pill>
                </td>
                <td className="px-3 font-mono text-muted">{m.base_weights ?? "–"}</td>
                <td className="px-3 text-right tabular-nums">{formatMetric(m.metrics?.map50)}</td>
                <td className="px-3 tabular-nums text-muted">{formatLocalDate(m.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
