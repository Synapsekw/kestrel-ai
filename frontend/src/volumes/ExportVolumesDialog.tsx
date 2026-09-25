import { useState, type FormEvent } from "react";
import type { VolumeMeasurement } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { createVolumeExport, type VolumeExportRequest } from "@/api/volumes";
import { useJobsStore } from "@/store/jobs";
import { Button, Checkbox, Dialog, Field, Input, toast } from "@/ui";
import { exportState } from "./model";

type Format = VolumeExportRequest["formats"][number];

const FORMATS: { value: Format; label: string; hint: string }[] = [
  {
    value: "pdf",
    label: "PDF report",
    hint: "a summary, one page per measurement with its plan view, and the method",
  },
  {
    value: "gpkg",
    label: "GeoPackage + cut/fill GeoTIFF",
    hint: "polygons and the dZ grid for QGIS, ArcGIS, Civil 3D",
  },
  { value: "csv", label: "CSV", hint: "one row per measurement" },
  { value: "xlsx", label: "Excel", hint: "the same rows as typed cells, plus the method and the warnings" },
];

/**
 * Starts a `volume_export` job (spec section 10). Only ready measurements can be exported: a stale
 * or failed one is shown disabled with the reason, so an exported number always matches its inputs.
 */
export function ExportVolumesDialog({
  projectId,
  measurements,
  preselected,
  onClose,
}: {
  projectId: string;
  measurements: VolumeMeasurement[];
  preselected: string[];
  onClose: () => void;
}) {
  const api = useApi();
  const exportable = measurements.filter((m) => exportState(m).enabled).map((m) => m.id);
  const initial = preselected.filter((id) => exportable.includes(id));
  const [ids, setIds] = useState<string[]>(initial.length ? initial : exportable);
  const [formats, setFormats] = useState<Format[]>(["pdf", "gpkg", "csv", "xlsx"]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ids.length || !formats.length) {
      setError("Choose at least one measurement and one format.");
      return;
    }
    setBusy(true);
    try {
      const job = await createVolumeExport(api, projectId, {
        measurement_ids: ids,
        formats: FORMATS.map((f) => f.value).filter((f) => formats.includes(f)),
        ...(title.trim() ? { title: title.trim() } : {}),
      });
      useJobsStore.getState().upsert(job);
      toast("info", "Export started: the files land in the project's exports folder when it is done.");
      onClose();
    } catch (err) {
      setError(messageOf(err, "could not start the export"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Export volumes"
      onClose={() => !busy && onClose()}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="download" loading={busy}>
            Export
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">Measurements</legend>
          {measurements.map((m) => {
            const state = exportState(m);
            return (
              <Checkbox
                key={m.id}
                checked={ids.includes(m.id)}
                disabled={!state.enabled}
                onChange={() => setIds((cur) => toggle(cur, m.id))}
                label={
                  <span>
                    <span className="text-ink">{m.name}</span>
                    {state.reason && <span className="text-muted"> — {state.reason}</span>}
                  </span>
                }
              />
            );
          })}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">Formats</legend>
          {FORMATS.map((f) => (
            <Checkbox
              key={f.value}
              checked={formats.includes(f.value)}
              onChange={() => setFormats((cur) => toggle(cur, f.value))}
              aria-label={f.label}
              label={
                <span>
                  <span className="text-ink">{f.label}</span> <span className="text-muted">— {f.hint}</span>
                </span>
              }
            />
          ))}
        </fieldset>
        <Field label="Report title" htmlFor="volume-export-title" hint="The project's name when left empty">
          <Input
            id="volume-export-title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
