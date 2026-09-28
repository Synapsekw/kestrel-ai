import { useState } from "react";
import type { Surface, VolumeMeasurement } from "@contract/client";
import { useApi } from "@/api/client";
import { calculateVolume, type VolumeMeasurementPatch } from "@/api/volumes";
import { messageOf } from "@/api/errors";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { useJobsStore } from "@/store/jobs";
import { Button, Field, Input, Pill, Progress, Select, toast } from "@/ui";
import { AlignmentSection } from "./AlignmentSection";
import { MasksSection } from "./MasksSection";
import { BASE_KIND_TEXT, PANEL_BASE_KINDS, type BaseKind } from "./model";

/**
 * The Measure tab (spec section 9): name, top surface, base, clutter masks and Calculate. Every
 * change is saved at once (PATCH), which marks a calculated measurement stale; numbers change only
 * when Calculate runs the job.
 */
export function MeasurePanel({
  projectId,
  measurement: m,
  top,
  surfaces,
  picking,
  onPick,
  onSave,
  onChanged,
}: {
  projectId: string;
  measurement: VolumeMeasurement;
  top: Surface;
  surfaces: Surface[];
  picking: boolean;
  onPick: () => void;
  onSave: (patch: VolumeMeasurementPatch) => void;
  onChanged: () => void;
}) {
  const api = useApi();
  const { job } = useTrackedJob(projectId, m.status === "calculating" ? m.job_id : null);
  const [name, setName] = useState(m.name);
  const [flatZ, setFlatZ] = useState(m.base.z != null ? String(m.base.z) : "");
  // A saved change comes back as a new measurement: re-seed the drafts during render (not in an
  // effect) so the fields follow the stored values.
  // (Revert to last calculated inputs is such a change too.)
  const stored = { name: m.name, z: m.base.z };
  const [seen, setSeen] = useState(stored);
  if (seen.name !== stored.name || seen.z !== stored.z) {
    setSeen(stored);
    setName(stored.name);
    setFlatZ(stored.z != null ? String(stored.z) : "");
  }

  // The top must stay in the polygon's CRS; the server refuses a top in another one.
  const sameCrs = surfaces.filter((s) => s.epsg === top.epsg && s.crs_wkt === top.crs_wkt);
  // A base may be in any CRS (spec §6.2, reprojected), but a local grid never pairs with a
  // georeferenced one: the server refuses that mix (422 invalid_base).
  const bases = surfaces
    .filter((s) => s.id !== top.id && (s.crs_wkt == null) === (top.crs_wkt == null))
    .sort((a, b) => (b.captured_on ?? "").localeCompare(a.captured_on ?? ""));
  const baseSurface = surfaces.find((s) => s.id === m.base.surface_id) ?? null;
  const calculating = m.status === "calculating";

  const setBase = (kind: BaseKind) => {
    if (kind === "flat") onSave({ base: { kind, z: m.base.z ?? top.z_min ?? 0 } });
    else if (kind === "surface") onSave({ base: { kind, surface_id: bases[0]?.id ?? null } });
    else onSave({ base: { kind } });
  };
  const calculate = () =>
    calculateVolume(api, projectId, m.id)
      .then((r) => {
        useJobsStore.getState().upsert(r.job);
        onChanged();
      })
      .catch((err: unknown) => toast("danger", messageOf(err, "could not start the calculation")));

  return (
    <div className="flex flex-col gap-4" data-testid="measure-panel">
      <Field label="Name" htmlFor="volume-name">
        <Input
          id="volume-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== m.name && onSave({ name: name.trim() })}
        />
      </Field>
      <Field label="Top surface" htmlFor="volume-top">
        <Select
          id="volume-top"
          value={m.top_surface_id}
          onChange={(e) => onSave({ top_surface_id: e.target.value })}
        >
          {sameCrs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Base" htmlFor="volume-base">
        <Select id="volume-base" value={m.base.kind} onChange={(e) => setBase(e.target.value as BaseKind)}>
          {PANEL_BASE_KINDS.map((k) => (
            <option key={k} value={k} disabled={k === "surface" && bases.length === 0}>
              {BASE_KIND_TEXT[k]}
            </option>
          ))}
          {!PANEL_BASE_KINDS.includes(m.base.kind) && (
            <option value={m.base.kind} disabled>
              {BASE_KIND_TEXT[m.base.kind]}
            </option>
          )}
        </Select>
      </Field>
      {m.base.kind === "flat" && (
        <Field
          label="Level (m)"
          htmlFor="volume-z"
          hint={`Heights as stored in the cloud; this site's ground is near ${(top.stats?.z_p02 ?? top.z_min ?? 0).toFixed(0)} m.`}
        >
          <div className="flex gap-2">
            <Input
              id="volume-z"
              type="number"
              step={0.01}
              value={flatZ}
              onChange={(e) => setFlatZ(e.target.value)}
              onBlur={() =>
                flatZ !== "" &&
                Number(flatZ) !== m.base.z &&
                onSave({ base: { kind: "flat", z: Number(flatZ) } })
              }
            />
            <Button size="sm" onClick={onPick} loading={picking}>
              Pick on map
            </Button>
          </div>
        </Field>
      )}
      {m.base.kind === "surface" && (
        <div className="flex flex-col gap-3">
          <Field label="Base surface" htmlFor="volume-base-surface">
            <Select
              id="volume-base-surface"
              value={m.base.surface_id ?? ""}
              onChange={(e) => onSave({ base: { kind: "surface", surface_id: e.target.value } })}
            >
              {bases.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.captured_on ?? "no date"}
                  {s.kind === "design" ? " · Design" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <AlignmentSection measurement={m} onSave={onSave} />
        </div>
      )}
      <MasksSection
        projectId={projectId}
        measurement={m}
        top={top}
        baseSurface={baseSurface}
        onSave={onSave}
      />
      {calculating ? (
        <div className="flex flex-col gap-1.5">
          <Pill tone="neutral" live>
            Calculating
          </Pill>
          <Progress value={job?.progress} running label="Calculating the volume" />
          {job?.message && <p className="text-xs text-muted">{job.message}</p>}
        </div>
      ) : (
        <Button variant="primary" onClick={() => void calculate()}>
          Calculate
        </Button>
      )}
    </div>
  );
}
