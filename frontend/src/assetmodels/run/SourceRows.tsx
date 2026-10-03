import type { ReactNode } from "react";
import type { DataItem } from "@/api/dataItems";
import { Checkbox, Pill } from "@/ui";

type RowStatus = DataItem["status"];

const STATUS_TEXT: Record<RowStatus, string> = {
  ready: "Ready",
  importing: "Importing",
  failed: "Failed",
};

export function GroupHead({ title, chosen, total }: { title: string; chosen: number; total: number | null }) {
  return (
    <legend className="mb-1.5 flex w-full items-baseline gap-2 text-xs font-medium text-muted">
      <span className="text-ink">{title}</span>
      <span className="font-mono text-2xs tabular-nums text-dim">
        {chosen > 0 ? `${chosen} chosen · ` : ""}
        {total ?? "…"}
      </span>
    </legend>
  );
}

export function SourceRow({
  label,
  meta,
  status,
  checked,
  onChange,
}: {
  label: ReactNode;
  meta?: ReactNode;
  status?: RowStatus;
  checked: boolean;
  onChange(on: boolean): void;
}) {
  const ready = !status || status === "ready";
  return (
    <li className="flex min-h-7 items-center rounded-sm px-1.5 hover:bg-hover">
      <Checkbox
        checked={checked}
        // A chosen source that is no longer ready stays untickable.
        disabled={!ready && !checked}
        onChange={(e) => onChange(e.target.checked)}
        className="min-w-0 flex-1"
        label={
          <span className="flex min-w-0 items-center gap-2">
            <span className={ready ? "truncate text-ink" : "truncate text-dim"}>{label}</span>
            {meta && <span className="shrink-0 font-mono text-2xs tabular-nums text-dim">{meta}</span>}
            {!ready && status && (
              <Pill size="sm" tone={status === "failed" ? "danger" : "warn"}>
                {STATUS_TEXT[status]}
              </Pill>
            )}
          </span>
        }
      />
    </li>
  );
}
