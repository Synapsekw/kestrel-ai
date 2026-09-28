import type { CSSProperties } from "react";
import type { DrawingLayer } from "@/api/drawings";
import { Button, Checkbox } from "@/ui";

export function LayerSwatch({ colour }: { colour: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ "--c": colour } as CSSProperties}
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-line bg-[var(--c)]"
    />
  );
}

/** Spec §8.2: the DXF/LandXML layers with colour and entity count; empty layers cannot be chosen. */
export function DrawingLayerPicker({
  layers,
  selected,
  onChange,
}: {
  layers: readonly DrawingLayer[];
  selected: readonly string[];
  onChange: (names: string[]) => void;
}) {
  const usable = layers.filter((l) => l.entity_count > 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => onChange(usable.map((l) => l.name))}>
          All
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onChange([])}>
          None
        </Button>
      </div>
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {layers.map((l) => (
          <li key={l.name}>
            <Checkbox
              label={
                <span className="flex items-center gap-2">
                  <LayerSwatch colour={l.colour} />
                  <span className="font-mono text-xs">{l.name}</span>
                  <span className="text-2xs tabular-nums text-muted">{l.entity_count}</span>
                </span>
              }
              checked={selected.includes(l.name)}
              disabled={l.entity_count === 0}
              onChange={(e) =>
                onChange(e.target.checked ? [...selected, l.name] : selected.filter((n) => n !== l.name))
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
