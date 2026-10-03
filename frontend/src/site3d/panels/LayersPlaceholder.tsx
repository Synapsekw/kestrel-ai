import { GlassPanel, Switch, cx } from "@/ui";
import type { LayerRow } from "../layerRows";

export interface LayersPlaceholderProps {
  rows: readonly LayerRow[];
  hidden: ReadonlySet<string>;
  onToggle(id: string, visible: boolean): void;
}

/** S1's minimal Layers list; S3's LayersPanel replaces it (opacity, colour-by, water and sky). */
export function LayersPlaceholder({ rows, hidden, onToggle }: LayersPlaceholderProps) {
  return (
    <GlassPanel
      variant="float"
      as="section"
      aria-label="Layers"
      data-testid="site-layers"
      className="w-64 p-2"
    >
      <h2 className="px-1.5 pb-1 text-xs text-muted">Layers</h2>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li
            key={r.id}
            aria-disabled={!r.available || undefined}
            className={cx(
              "flex h-8 items-center justify-between gap-3 rounded-sm px-1.5",
              !r.available && "text-dim",
            )}
          >
            {r.available && r.toggleable ? (
              <Switch checked={!hidden.has(r.id)} onChange={(v) => onToggle(r.id, v)} label={r.label} />
            ) : (
              <span className={cx("text-sm", r.available ? "text-ink" : "text-dim")}>{r.label}</span>
            )}
            <span className="truncate font-mono text-2xs tabular-nums text-muted">{r.detail}</span>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}
