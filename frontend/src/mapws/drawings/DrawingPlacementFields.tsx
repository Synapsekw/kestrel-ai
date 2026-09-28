import type { LinearUnit } from "@/api/designSurfaces";
import type { DrawingInspection } from "@/api/drawings";
import { UNIT_OPTIONS } from "@/surfaces/designImport";
import { Field, Input, Pill, Segmented, Select } from "@/ui";
import { familyOf, placementChoices, type DrawingForm } from "./drawingImport";

export function DrawingPlacementFields({
  inspection,
  form,
  onChange,
}: {
  inspection: DrawingInspection;
  form: DrawingForm;
  onChange: (form: DrawingForm) => void;
}) {
  const choices = placementChoices(inspection);
  const family = familyOf(inspection.format);
  const worldFile = form.placement === "embedded" && inspection.embedded?.needs_crs === true;
  const needsEpsg = form.placement === "crs" || worldFile;
  return (
    <div className="flex flex-col gap-3">
      {choices.length > 1 ? (
        <Segmented
          label="Placement"
          options={choices}
          value={form.placement}
          onChange={(placement) => onChange({ ...form, placement })}
        />
      ) : (
        <p className="text-sm text-muted">
          {family === "pdf" ? "A PDF is placed" : "It is placed"} with control points once it is imported:
          select it on the map and press K.
        </p>
      )}
      {choices.length > 1 && form.placement === "none" && (
        <p className="text-sm text-muted">
          It shows as not placed until you align it with control points (K).
        </p>
      )}
      {needsEpsg && (
        <Field
          label="EPSG code"
          htmlFor="drawing-epsg"
          hint={
            worldFile
              ? "A world file carries no CRS: enter the EPSG code of its coordinates."
              : "The CRS of the drawing's coordinates."
          }
        >
          <div className="flex items-center gap-2">
            <Input
              id="drawing-epsg"
              inputMode="numeric"
              value={form.epsg}
              onChange={(e) => onChange({ ...form, epsg: e.target.value })}
              placeholder="32638"
              className="w-40 font-mono"
            />
            {inspection.crs_hint && form.placement === "crs" && (
              <Pill tone="warn" size="sm">
                File says {inspection.crs_hint} · unverified
              </Pill>
            )}
          </div>
        </Field>
      )}
      {family === "vector" && (
        <Field
          label="Drawing units"
          htmlFor="drawing-units"
          hint={
            inspection.units_source
              ? `From the file: ${inspection.units_source}`
              : "Used to place the drawing and to check a control-point fit."
          }
        >
          <Select
            id="drawing-units"
            value={form.units ?? "metre"}
            onChange={(e) => onChange({ ...form, units: e.target.value as LinearUnit })}
          >
            {UNIT_OPTIONS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </div>
  );
}
