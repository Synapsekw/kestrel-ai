import type { ImageMode, QueryForm } from "./queryModel";

interface Props {
  form: QueryForm;
  onChange: (patch: Partial<QueryForm>) => void;
  preloadedCount: number;
  count: number;
  loading: boolean;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm disabled:opacity-50";
const label = "flex flex-col gap-1 text-xs text-slate-400";

export function ImagePicker({ form, onChange, preloadedCount, count, loading }: Props) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium">Images</legend>
      <div className="flex flex-wrap items-end gap-3">
        <label className={label}>
          Images
          <select
            aria-label="Images"
            value={form.mode}
            onChange={(e) => onChange({ mode: e.target.value as ImageMode })}
            className={input}
          >
            <option value="selection" disabled={preloadedCount === 0}>
              Data Manager selection ({preloadedCount})
            </option>
            <option value="unlabeled">All unlabeled images</option>
            <option value="group">Images in a group</option>
            <option value="first_n">First N images</option>
          </select>
        </label>
        {form.mode === "group" && (
          <label className={label}>
            Group key
            <input
              aria-label="Group key"
              value={form.groupKey}
              onChange={(e) => onChange({ groupKey: e.target.value })}
              className={input}
            />
          </label>
        )}
        {form.mode === "first_n" && (
          <label className={label}>
            Number of images
            <input
              aria-label="Number of images"
              type="number"
              min={1}
              value={form.firstN}
              onChange={(e) => onChange({ firstN: e.target.value })}
              className={`${input} w-24`}
            />
          </label>
        )}
      </div>
      <p data-testid="image-count" className="text-xs text-slate-300">
        {loading ? "Counting images…" : `${count} ${count === 1 ? "image" : "images"} selected`}
      </p>
    </fieldset>
  );
}
