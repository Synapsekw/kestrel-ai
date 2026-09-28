import { useEffect, useState } from "react";
import type { GeoMap, MapRun, Surface, VolumeMeasurement } from "@contract/client";
import { useApi } from "@/api/client";
import { listMapRuns, listMaps } from "@/api/maps";
import type { VolumeMeasurementPatch } from "@/api/volumes";
import { useProject } from "@/api/project";
import { Checkbox, Disclosure, Field, IconButton, Input, Select } from "@/ui";
import { groupRuns } from "./model";

/** The clutter masks (spec 2026-09-23-volumes §6.5), shared by the Measurements view and the map
 * workspace inspector: detection runs to mask by flight, a buffer around them, classes to mask and
 * manual exclusion polygons. */
export function MasksSection({
  projectId,
  measurement: m,
  top,
  baseSurface,
  onSave,
}: {
  projectId: string;
  measurement: VolumeMeasurement;
  top: Surface;
  baseSurface: Surface | null;
  onSave: (patch: VolumeMeasurementPatch) => void;
}) {
  const api = useApi();
  const { project } = useProject(projectId);
  const [maps, setMaps] = useState<GeoMap[]>([]);
  const [runs, setRuns] = useState<MapRun[]>([]);
  const [buffer, setBuffer] = useState(String(m.masks.buffer_m));
  // A saved change comes back as a new measurement: re-seed the draft during render (not in an
  // effect) so the field follows the stored value.
  const [seenBuffer, setSeenBuffer] = useState(m.masks.buffer_m);
  if (seenBuffer !== m.masks.buffer_m) {
    setSeenBuffer(m.masks.buffer_m);
    setBuffer(String(m.masks.buffer_m));
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

  const groups = groupRuns(runs, top.map_id, baseSurface?.map_id ?? null);
  const mapName = (id: string) => maps.find((x) => x.id === id)?.name ?? "map";
  const toggleRun = (id: string) => {
    const ids = m.masks.detection_run_ids;
    onSave({ masks: { detection_run_ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] } });
  };

  return (
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
  );
}
