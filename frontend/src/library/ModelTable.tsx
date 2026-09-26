import type { LibraryModel } from "@contract/client";
import { Button, Pill, cx } from "@/ui";
import { originLabel, taskLabel } from "./modelLabels";

interface Props {
  models: LibraryModel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const HEADERS: { label: string; className?: string }[] = [
  { label: "Name" },
  { label: "Origin" },
  { label: "Task" },
  { label: "Classes", className: "text-right" },
];

/** The library list: one 36px row per model; the name selects it (so does a click anywhere on the row). */
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
                <td className="max-w-0 px-1.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Select model ${m.name}`}
                      onClick={() => onSelect(m.id)}
                      className="min-w-0 font-semibold"
                    >
                      <span className="truncate">{m.name}</span>
                    </Button>
                    {m.state === "unavailable" && (
                      <Pill tone="warn" size="sm" title="The weights file is missing from the library folder">
                        File missing
                      </Pill>
                    )}
                  </span>
                </td>
                <td className="px-3">
                  <Pill tone={m.origin === "trained" ? "ok" : "neutral"} size="sm">
                    {originLabel(m.origin)}
                  </Pill>
                </td>
                <td className="whitespace-nowrap px-3 text-muted">{taskLabel(m.task)}</td>
                <td className="px-3 text-right tabular-nums text-muted">{m.class_names.length}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
