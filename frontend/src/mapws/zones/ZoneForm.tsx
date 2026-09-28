import { useId, useState } from "react";
import { Button, Field, Input, Select } from "@/ui";
import { CATEGORY_LABEL, ZONE_CATEGORIES, type ZoneCategory } from "./categories";

export interface ZoneFormProps {
  onSubmit: (value: { name: string; category: ZoneCategory }) => void;
  onCancel: () => void;
  busy?: boolean;
}

/** Spec §5.1 "Zone": the name and category popover after the outline closes. */
export function ZoneForm({ onSubmit, onCancel, busy }: ZoneFormProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ZoneCategory>("general");
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const categoryId = useId();
  return (
    <form
      className="flex w-[280px] flex-col gap-3 p-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        const n = name.trim();
        if (!n) return setError("Name the zone");
        onSubmit({ name: n, category });
      }}
    >
      <Field label="Name" htmlFor={nameId} error={error}>
        <Input
          id={nameId}
          value={name}
          maxLength={200}
          placeholder="Crane exclusion"
          autoComplete="off"
          invalid={error !== null}
          aria-describedby={error ? `${nameId}-error` : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
      </Field>
      <Field label="Category" htmlFor={categoryId}>
        <Select
          id={categoryId}
          value={category}
          onChange={(e) => setCategory(e.target.value as ZoneCategory)}
        >
          {ZONE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          Save zone
        </Button>
      </div>
    </form>
  );
}
