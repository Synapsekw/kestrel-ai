import { useId } from "react";
import { Field, Input, Select } from "@/ui";
import type { ImageMode, QueryForm } from "./queryModel";

interface Props {
  form: QueryForm;
  onChange: (patch: Partial<QueryForm>) => void;
  preloadedCount: number;
  count: number;
  loading: boolean;
  /** The project's groups (flights); empty when unknown, then the key is typed. */
  groups: { group_key: string; image_count: number }[];
}

export function ImagePicker({ form, onChange, preloadedCount, count, loading, groups }: Props) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start gap-4">
        <Field label="Images" htmlFor={`${id}-mode`} className="w-64">
          <Select
            id={`${id}-mode`}
            value={form.mode}
            onChange={(e) => onChange({ mode: e.target.value as ImageMode })}
          >
            <option value="selection" disabled={preloadedCount === 0}>
              Selection from Images ({preloadedCount})
            </option>
            <option value="unlabeled">All unlabeled images</option>
            <option value="group">Images in a flight or tile</option>
            <option value="first_n">First N images</option>
          </Select>
        </Field>
        {form.mode === "group" && (
          <Field label="Flight or tile" htmlFor={`${id}-group`} className="w-64">
            {groups.length > 0 ? (
              <Select
                id={`${id}-group`}
                value={form.groupKey}
                onChange={(e) => onChange({ groupKey: e.target.value })}
              >
                <option value="">Choose a flight or tile</option>
                {groups.map((g) => (
                  <option key={g.group_key} value={g.group_key}>
                    {g.group_key} ({g.image_count} {g.image_count === 1 ? "image" : "images"})
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={`${id}-group`}
                value={form.groupKey}
                onChange={(e) => onChange({ groupKey: e.target.value })}
              />
            )}
          </Field>
        )}
        {form.mode === "first_n" && (
          <Field
            label="Number of images"
            htmlFor={`${id}-first-n`}
            hint="In file-name order, labeled images included."
          >
            <Input
              id={`${id}-first-n`}
              type="number"
              min={1}
              value={form.firstN}
              onChange={(e) => onChange({ firstN: e.target.value })}
              className="w-28 tabular-nums"
            />
          </Field>
        )}
      </div>
      <p data-testid="image-count" className="text-[13px] tabular-nums text-muted">
        {loading ? "Counting images…" : `${count} ${count === 1 ? "image" : "images"} selected`}
      </p>
    </div>
  );
}
