import { useState, type FormEvent } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { createSurface, type PointCloudOut, type SurfaceWithJob } from "@/api/surfaces";
import { useJobsStore } from "@/store/jobs";
import { Button, Checkbox, Dialog, Disclosure, Field, Input, Segmented, Select } from "@/ui";
import { CELL_LADDER, METHODS, buildDefaults, buildRequest, type BuildForm } from "./model";

/**
 * Build a surface from a point cloud (spec sections 5.1 and 9): cloud, name, the per-cell statistic
 * with its measured bias, the cell size (auto: about 4 points per cell), the gap to fill, and an
 * Advanced section for despike, Z clip, noise classes and "Assume metres" (clouds without a CRS).
 */
export function BuildSurfaceDialog({
  projectId,
  clouds,
  initialCloudId,
  onClose,
  onStarted,
}: {
  projectId: string;
  clouds: PointCloudOut[];
  initialCloudId?: string;
  onClose: () => void;
  onStarted: (created: SurfaceWithJob) => void;
}) {
  const api = useApi();
  const ready = clouds.filter((c) => c.status === "ready");
  const first = ready.find((c) => c.id === initialCloudId) ?? ready[0];
  const [form, setForm] = useState<BuildForm | null>(first ? buildDefaults(first) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cloud = ready.find((c) => c.id === form?.pointCloudId);
  const set = (patch: Partial<BuildForm>) => setForm((f) => (f ? { ...f, ...patch } : f));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      const created = await createSurface(api, projectId, buildRequest(form));
      useJobsStore.getState().upsert(created.job);
      onStarted(created);
    } catch (err) {
      setError(messageOf(err, "could not start the build"));
    } finally {
      setBusy(false);
    }
  }

  const method = METHODS.find((m) => m.value === form?.method);
  return (
    <Dialog
      open
      title="Build a surface"
      width="lg"
      onClose={() => !busy && onClose()}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!form}>
            Build
          </Button>
        </>
      }
    >
      {!form ? (
        <p className="text-sm text-muted">
          Import a point cloud first: a surface is built from a ready cloud.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Point cloud" htmlFor="build-cloud">
            <Select
              id="build-cloud"
              value={form.pointCloudId}
              onChange={(e) => {
                const next = ready.find((c) => c.id === e.target.value);
                if (next) setForm(buildDefaults(next));
              }}
            >
              {ready.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name" htmlFor="build-name">
            <Input id="build-name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <div className="flex flex-col gap-1">
            <Segmented
              label="Height per cell"
              value={form.method}
              onChange={(v) => set({ method: v })}
              options={METHODS.map((m) => ({ value: m.value, label: m.label }))}
            />
            <p className="text-xs text-muted">{method?.bias}</p>
          </div>
          <Field label="Cell size" htmlFor="build-cell">
            <Select
              id="build-cell"
              value={String(form.cell)}
              onChange={(e) => set({ cell: e.target.value === "auto" ? "auto" : Number(e.target.value) })}
            >
              <option value="auto">Auto — about 4 points per cell</option>
              {CELL_LADDER.map((c) => (
                <option key={c} value={String(c)}>
                  {c} m
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fill gaps up to (m)" htmlFor="build-fill" hint="0 turns gap filling off">
            <Input
              id="build-fill"
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={form.holeFillM}
              onChange={(e) => set({ holeFillM: Number(e.target.value) })}
            />
          </Field>
          <Disclosure label="Advanced">
            <div className="flex flex-col gap-3 pt-2">
              <Checkbox
                label="Remove isolated spikes"
                checked={form.despikeOn}
                onChange={(e) => set({ despikeOn: e.target.checked })}
              />
              {form.despikeOn && (
                <Field label="Spike height (m)" htmlFor="build-despike">
                  <Input
                    id="build-despike"
                    type="number"
                    min={0.1}
                    max={100}
                    step={0.1}
                    value={form.despikeM}
                    onChange={(e) => set({ despikeM: Number(e.target.value) })}
                  />
                </Field>
              )}
              <Checkbox
                label="Clip heights"
                checked={form.zClip !== null}
                onChange={(e) => set({ zClip: e.target.checked ? [-100, 1000] : null })}
              />
              {form.zClip && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Lowest Z (m)" htmlFor="build-zlo">
                    <Input
                      id="build-zlo"
                      type="number"
                      value={form.zClip[0]}
                      onChange={(e) => set({ zClip: [Number(e.target.value), form.zClip![1]] })}
                    />
                  </Field>
                  <Field label="Highest Z (m)" htmlFor="build-zhi">
                    <Input
                      id="build-zhi"
                      type="number"
                      value={form.zClip[1]}
                      onChange={(e) => set({ zClip: [form.zClip![0], Number(e.target.value)] })}
                    />
                  </Field>
                </div>
              )}
              <Checkbox
                label="Drop points classed as noise (LAS classes 7 and 18)"
                checked={form.dropNoise}
                onChange={(e) => set({ dropNoise: e.target.checked })}
              />
              {cloud && !cloud.crs_wkt && (
                <Checkbox
                  label="Assume metres (this cloud has no coordinate system)"
                  checked={form.assumeMetres}
                  onChange={(e) => set({ assumeMetres: e.target.checked })}
                />
              )}
            </div>
          </Disclosure>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
