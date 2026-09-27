import { useRef, useState, type KeyboardEvent } from "react";
import { Input, Segmented } from "@/ui";
import type { LayerRowExtraProps } from "./layerRegistry";
import { parseRasterStyle, type SurfaceStyle } from "./rasterStyle";

const OPTIONS: { value: SurfaceStyle; label: string }[] = [
  { value: "hillshade", label: "Hillshade" },
  { value: "tint", label: "Tint" },
  { value: "contours", label: "Contours" },
];

/** M §5.2 Elevation render modes, under the row's opacity slider (deviation 3). */
export function ElevationStyle({ row, style, setStyle }: LayerRowExtraProps) {
  const { render, interval } = parseRasterStyle(style);
  const [draft, setDraft] = useState(interval === null ? "" : String(interval));
  // The last interval this control committed: Enter then blur must not commit twice, and clearing
  // after a commit must commit `null` even before the new style comes back through the prop.
  const committed = useRef(interval);
  const parsed = draft.trim() === "" ? null : Number(draft);
  const invalid = parsed !== null && !(Number.isFinite(parsed) && parsed > 0);
  const commit = () => {
    if (invalid || parsed === committed.current) return;
    committed.current = parsed;
    setStyle({ interval: parsed });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
  };
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <Segmented
        size="sm"
        label={`${row.name} render mode`}
        value={render}
        options={OPTIONS}
        onChange={(v) => setStyle({ render: v })}
      />
      {render === "contours" && (
        <Input
          dense
          type="number"
          min={0.01}
          step={0.1}
          inputMode="decimal"
          placeholder="auto"
          value={draft}
          invalid={invalid}
          aria-label={`Contour interval of ${row.name} (m)`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          className="w-16 font-mono tabular-nums"
        />
      )}
    </div>
  );
}
