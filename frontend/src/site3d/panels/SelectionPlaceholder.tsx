import { GlassPanel, IconButton, Pill } from "@/ui";
import type { PickHit } from "../layers/types";

const HEIGHT_FROM: Record<string, string> = {
  drawing: "Drawing",
  cloud: "Point cloud",
  indicative: "Indicative",
};

function flagList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string") return v.split(/[;,\s]+/).filter((s) => s && s !== "[]");
  return [];
}

const human = (code: string) => (code.charAt(0).toUpperCase() + code.slice(1)).replace(/_/g, " ");

/** S1's selected-item card from the node extras; S3's ItemPanel (register row, source, Edit) replaces it. */
export function SelectionPlaceholder({ hit, onClear }: { hit: PickHit; onClear(): void }) {
  const x = hit.extras;
  const s = (k: string) => (typeof x[k] === "string" && x[k] !== "" ? (x[k] as string) : null);
  const heightFrom = s("height_source") ?? s("h_src");
  const flags = flagList(x.flags);
  return (
    <GlassPanel
      variant="float"
      as="aside"
      aria-label="Selected item"
      data-testid="site-selection"
      className="w-72 p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-lg text-ink">{s("name") ?? hit.itemId}</p>
          {s("tag") && <p className="font-mono text-xs text-muted">{s("tag")}</p>}
        </div>
        <IconButton icon="x" label="Clear selection" size="sm" onClick={onClear} />
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Type</dt>
        <dd className="truncate text-ink">{s("type") ?? "Not set"}</dd>
        <dt className="text-muted">Area</dt>
        <dd className="text-ink">{s("area") ?? "Not set"}</dd>
        <dt className="text-muted">Height from</dt>
        <dd className="text-ink">{heightFrom ? (HEIGHT_FROM[heightFrom] ?? heightFrom) : "Not set"}</dd>
      </dl>
      {flags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <Pill key={f} tone="warn" size="sm">
              {human(f)}
            </Pill>
          ))}
        </div>
      )}
      <p className="mt-3 font-mono text-2xs text-dim">Item {hit.itemId}</p>
    </GlassPanel>
  );
}
