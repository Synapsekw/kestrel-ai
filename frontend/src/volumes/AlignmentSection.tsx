import type { ReactNode } from "react";
import type { VolumeMeasurement } from "@contract/client";
import type { VolumeMeasurementPatch } from "@/api/volumes";
import { Switch } from "@/ui";

/** The stable-area check against another surface (spec 2026-09-23-volumes §6.4), shared by the
 * Measurements view and the map workspace inspector. */
export function AlignmentSection({
  measurement: m,
  onSave,
  drawHint = "Draw a stable area (S) on ground that did not change between the surveys.",
}: {
  measurement: VolumeMeasurement;
  onSave: (patch: VolumeMeasurementPatch) => void;
  drawHint?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        {m.alignment.stable_polygon
          ? "Stable area drawn: it checks that the surveys agree on ground that did not change."
          : drawHint}
      </p>
      {m.alignment.measured && (
        <p className="text-xs tabular-nums text-muted">
          Median dZ {m.alignment.measured.median_dz.toFixed(3)} m · σ {m.alignment.measured.sigma.toFixed(3)}{" "}
          m · tilt {m.alignment.measured.tilt_mm_per_m.toFixed(2)} mm/m
        </p>
      )}
      <Switch
        label="Correct vertical shift"
        checked={m.alignment.apply_shift}
        disabled={!m.alignment.stable_polygon}
        onChange={(on) => onSave({ alignment: { apply_shift: on } })}
      />
    </div>
  );
}
