import type { QueryForm } from "./queryModel";

interface Props {
  form: QueryForm;
  onChange: (patch: Partial<QueryForm>) => void;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm disabled:opacity-50";
const label = "flex flex-col gap-1 text-xs text-slate-400";

/** Spec section 8 tiling (default 1280 px, overlap 0.2, NMS IoU 0.5) and the confidence threshold. */
export function TilingFields({ form, onChange }: Props) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium">Tiling and confidence</legend>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            aria-label="Tiling"
            checked={form.tilingEnabled}
            onChange={(e) => onChange({ tilingEnabled: e.target.checked })}
          />
          Tile large images
        </label>
        <label className={label}>
          Tile size
          <input
            aria-label="Tile size"
            type="number"
            min={256}
            max={4096}
            step={64}
            value={form.tileSize}
            disabled={!form.tilingEnabled}
            onChange={(e) => onChange({ tileSize: e.target.value })}
            className={`${input} w-24`}
          />
        </label>
        <label className={label}>
          Overlap
          <input
            aria-label="Overlap"
            type="number"
            min={0}
            max={0.5}
            step={0.05}
            value={form.overlap}
            disabled={!form.tilingEnabled}
            onChange={(e) => onChange({ overlap: e.target.value })}
            className={`${input} w-24`}
          />
        </label>
        <label className={label}>
          NMS IoU
          <input
            aria-label="NMS IoU"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={form.nmsIou}
            disabled={!form.tilingEnabled}
            onChange={(e) => onChange({ nmsIou: e.target.value })}
            className={`${input} w-24`}
          />
        </label>
        <label className={label}>
          Confidence
          <input
            aria-label="Confidence"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={form.conf}
            onChange={(e) => onChange({ conf: e.target.value })}
            className={`${input} w-24`}
          />
        </label>
      </div>
    </fieldset>
  );
}
