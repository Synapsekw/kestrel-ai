import { useEffect, useState } from "react";
import type { GeoMap, MapRun, Surface, VolumeMeasurement } from "@contract/client";
import { useApi } from "@/api/client";
import { listMapRuns, listMaps } from "@/api/maps";
import { calculateVolume, type VolumeMeasurementPatch } from "@/api/volumes";
import { messageOf } from "@/api/errors";
import { useProject } from "@/api/project";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { useJobsStore } from "@/store/jobs";
import {
  Button,
  Checkbox,
  Disclosure,
  Field,
  IconButton,
  Input,
  Pill,
  Progress,
  Select,
  Switch,
  toast,
} from "@/ui";
import { BASE_KIND_TEXT, groupRuns, type BaseKind } from "./model";

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
  const { project } = useProject(projectId);
  const { job } = useTrackedJob(projectId, m.status === "calculating" ? m.job_id : null);
  const [name, setName] = useState(m.name);
  const [flatZ, setFlatZ] = useState(m.base.z != null ? String(m.base.z) : "");
  const [buffer, setBuffer] = useState(String(m.masks.buffer_m));
  const [maps, setMaps] = useState<GeoMap[]>([]);
  const [runs, setRuns] = useState<MapRun[]>([]);
  // A saved change comes back as a new measurement: re-seed the drafts during render (not in an
  // effect) so the fields follow the stored values.
  // (Revert to last calculated inputs is such a change too.)
  const stored = { name: m.name, z: m.base.z, buffer: m.masks.buffer_m };
  const [seen, setSeen] = useState(stored);
  if (seen.name !== stored.name || seen.z !== stored.z || seen.buffer !== stored.buffer) {
    setSeen(stored);
    setName(stored.name);
    setFlatZ(stored.z != null ? String(stored.z) : "");
    setBuffer(String(stored.buffer));
  }

  useEffect(() => {
    let cancelled = false;
    listMaps(api, projectId)
      .then(async (all) => {
        const ready = all.filter((x) => x.status === "ready" && x.crs_wkt);
        const perMap = await Promise.all(ready.map((x) => listMapRuns(api, projectId, x.id)));
        if (!cancelled) {
          setMaps(ready);
          setRuns(perMap.flat());
        }
      })
      .catch(() => undefined); // masking is optional: without maps the list is simply empty
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);

  const sameCrs = surfaces.filter((s) => s.epsg === top.epsg && s.crs_wkt === top.crs_wkt);
  // A base must share the top's grid CRS, as the top list does; the server refuses anything else.
  const bases = [...sameCrs]
    .filter((s) => s.id !== top.id)
    .sort((a, b) => (b.captured_on ?? "").localeCompare(a.captured_on ?? ""));
  const baseSurface = surfaces.find((s) => s.id === m.base.surface_id) ?? null;
  const groups = groupRuns(runs, top.map_id, baseSurface?.map_id ?? null);
  const mapName = (id: string) => maps.find((x) => x.id === id)?.name ?? "map";
  const calculating = m.status === "calculating";

  const setBase = (kind: BaseKind) => {
    if (kind === "flat") onSave({ base: { kind, z: m.base.z ?? top.z_min ?? 0 } });
    else if (kind === "surface") onSave({ base: { kind, surface_id: bases[0]?.id ?? null } });
    else onSave({ base: { kind } });
  };
  const toggleRun = (id: string) => {
    const ids = m.masks.detection_run_ids;
    onSave({ masks: { detection_run_ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] } });
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
          {(Object.keys(BASE_KIND_TEXT) as BaseKind[]).map((k) => (
            <option key={k} value={k} disabled={k === "surface" && bases.length === 0}>
              {BASE_KIND_TEXT[k]}
            </option>
          ))}
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
          <p className="text-sm text-muted">
            {m.alignment.stable_polygon
              ? "Stable area drawn: it checks that the surveys agree on ground that did not change."
              : "Draw a stable area (S) on ground that did not change between the surveys."}
          </p>
          {m.alignment.measured && (
            <p className="text-xs tabular-nums text-muted">
              Median dZ {m.alignment.measured.median_dz.toFixed(3)} m · σ{" "}
              {m.alignment.measured.sigma.toFixed(3)} m · tilt {m.alignment.measured.tilt_mm_per_m.toFixed(2)}{" "}
              mm/m
            </p>
          )}
          <Switch
            label="Correct vertical shift"
            checked={m.alignment.apply_shift}
            disabled={!m.alignment.stable_polygon}
            onChange={(on) => onSave({ alignment: { apply_shift: on } })}
          />
        </div>
      )}
      <Disclosure
        label={`Machines and exclusions (${m.masks.detection_run_ids.length + m.masks.exclusion_polygons.length})`}
        defaultOpen
      >
        <div className="flex flex-col gap-3 pt-2">
          {groups.length === 0 && (
            <p className="text-sm text-muted">No finished detection runs on maps with coordinates.</p>
          )}
          {groups.map((g) => (
            <fieldset key={g.title} className="flex flex-col gap-1.5">
              <legend className="mb-1 text-xs font-medium text-muted">{g.title}</legend>
              {g.runs.map((r) => (
                <Checkbox
                  key={r.id}
                  checked={m.masks.detection_run_ids.includes(r.id)}
                  onChange={() => toggleRun(r.id)}
                  label={`${mapName(r.map_id)} · ${r.model_name ?? r.provider ?? "run"} · ${r.created_at.slice(0, 10)} · ${r.detection_count}`}
                />
              ))}
            </fieldset>
          ))}
          <Field label="Buffer around machines (m)" htmlFor="volume-buffer">
            <Input
              id="volume-buffer"
              type="number"
              min={0}
              max={5}
              step={0.1}
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              onBlur={() =>
                buffer !== "" &&
                Number(buffer) !== m.masks.buffer_m &&
                onSave({ masks: { buffer_m: Number(buffer) } })
              }
            />
          </Field>
          {project && (
            <Disclosure label="Classes to mask">
              <div className="flex flex-col gap-1.5 pt-2">
                {project.classes.map((c) => {
                  const on = m.masks.class_ids === null || m.masks.class_ids.includes(c.id);
                  const all = project.classes.map((x) => x.id);
                  const next = (checked: boolean) => {
                    const current = m.masks.class_ids ?? all;
                    const ids = checked ? [...current, c.id] : current.filter((x) => x !== c.id);
                    return ids.length === all.length ? null : ids;
                  };
                  return (
                    <Checkbox
                      key={c.id}
                      label={c.name}
                      checked={on}
                      onChange={(e) => onSave({ masks: { class_ids: next(e.target.checked) } })}
                    />
                  );
                })}
              </div>
            </Disclosure>
          )}
          {m.masks.exclusion_polygons.length > 0 && (
            <ul className="flex flex-col gap-1.5" aria-label="Exclusions">
              {m.masks.exclusion_polygons.map((e, i) => (
                <li key={e.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">Exclusion {i + 1}</span>
                  <Select
                    dense
                    aria-label={`Exclusion ${i + 1} mode`}
                    wrapperClassName="w-28"
                    value={e.mode}
                    onChange={(ev) =>
                      onSave({
                        masks: {
                          exclusion_polygons: m.masks.exclusion_polygons.map((x) =>
                            x.id === e.id ? { ...x, mode: ev.target.value as "patch" | "exclude" } : x,
                          ),
                        },
                      })
                    }
                  >
                    <option value="patch">Patch</option>
                    <option value="exclude">Exclude</option>
                  </Select>
                  <IconButton
                    size="sm"
                    icon="trash"
                    label={`Delete exclusion ${i + 1}`}
                    onClick={() =>
                      onSave({
                        masks: {
                          exclusion_polygons: m.masks.exclusion_polygons.filter((x) => x.id !== e.id),
                        },
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Disclosure>
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
