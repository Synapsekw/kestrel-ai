import type { DesignInspection, LinearUnit, Surface } from "@/api/designSurfaces";
import { Field, Input, Select, Switch } from "@/ui";
import { crsHint, pointsSelected, UNIT_OPTIONS, type ImportForm } from "./designImport";

function UnitSelect({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: LinearUnit | "";
  disabled?: boolean;
  onChange: (u: LinearUnit) => void;
}) {
  return (
    <Select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as LinearUnit)}
    >
      {value === "" && <option value="">Choose…</option>}
      {UNIT_OPTIONS.map((u) => (
        <option key={u.value} value={u.value}>
          {u.label}
        </option>
      ))}
    </Select>
  );
}

export function DesignPlacement({
  inspection,
  form,
  targets,
  onChange,
}: {
  inspection: DesignInspection;
  form: ImportForm;
  targets: Surface[];
  onChange: (form: ImportForm) => void;
}) {
  const set = (patch: Partial<ImportForm>) => onChange({ ...form, ...patch });
  const geotiff = inspection.format === "geotiff";
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field
        label="Target cloud surface"
        htmlFor="design-target"
        hint="The design lands on this surface's grid and CRS, cell for cell."
        className="sm:col-span-2"
      >
        <Select
          id="design-target"
          value={form.targetSurfaceId}
          onChange={(e) => set({ targetSurfaceId: e.target.value })}
        >
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.cell_size_m} m cells
            </option>
          ))}
          <option value="">None — keep the design's own CRS</option>
        </Select>
      </Field>
      <Field
        label="Source CRS"
        htmlFor="design-crs"
        hint={crsHint(inspection, form, targets)}
        className="sm:col-span-2"
      >
        <Input
          id="design-crs"
          value={form.sourceCrs}
          onChange={(e) => set({ sourceCrs: e.target.value })}
          placeholder="EPSG:32639"
          className="font-mono"
        />
      </Field>
      <Field
        label="Horizontal units"
        htmlFor="design-hunit"
        hint={geotiff ? "Set by the file's CRS." : inspection.detected?.unit_source}
      >
        <UnitSelect
          id="design-hunit"
          value={form.horizontalUnit}
          disabled={geotiff}
          onChange={(u) => set({ horizontalUnit: u })}
        />
      </Field>
      <Field label="Height units" htmlFor="design-vunit">
        <UnitSelect id="design-vunit" value={form.verticalUnit} onChange={(u) => set({ verticalUnit: u })} />
      </Field>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Switch
          label="Swap easting and northing"
          checked={form.swapXy}
          onChange={(v) => set({ swapXy: v })}
        />
        {inspection.format === "landxml" && (
          <span className="text-xs text-muted">LandXML stores northing first — already handled</span>
        )}
      </div>
      {!form.targetSurfaceId && (
        <Field label="Cell size (m)" htmlFor="design-cell">
          <Input
            id="design-cell"
            inputMode="decimal"
            value={form.cellSizeM}
            onChange={(e) => set({ cellSizeM: e.target.value })}
          />
        </Field>
      )}
      {pointsSelected(inspection, form) && (
        <Field
          label="Maximum edge length (m)"
          htmlFor="design-maxedge"
          hint="Long triangles at the edges are trimmed; 0 keeps them all."
        >
          <Input
            id="design-maxedge"
            inputMode="decimal"
            placeholder="automatic"
            value={form.maxEdgeM}
            onChange={(e) => set({ maxEdgeM: e.target.value })}
          />
        </Field>
      )}
    </div>
  );
}
