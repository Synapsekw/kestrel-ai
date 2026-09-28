import { Segmented, Select } from "@/ui";
import {
  KIND_OPTIONS,
  subKindLabel,
  subKindOptions,
  type KindFilter,
  type MeasurementFilters,
} from "./model";

export function MeasurementFiltersBar({
  filters,
  onChange,
}: {
  filters: MeasurementFilters;
  onChange: (next: MeasurementFilters) => void;
}) {
  const types = subKindOptions(filters.kind, filters.subKind);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Segmented<KindFilter>
        label="Measurement source"
        size="sm"
        options={KIND_OPTIONS}
        value={filters.kind}
        // A kind change clears the type (R-W6-4).
        onChange={(kind) => onChange({ kind, subKind: null })}
      />
      {types.length > 0 && (
        <Select
          aria-label="Measurement type"
          dense
          wrapperClassName="w-44"
          value={filters.subKind ?? ""}
          onChange={(e) => onChange({ ...filters, subKind: e.target.value || null })}
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {subKindLabel(t)}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
