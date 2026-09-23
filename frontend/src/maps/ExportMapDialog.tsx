import { useState, type FormEvent } from "react";
import type { GeoMap, MapRun } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { createMapExport, type MapExportRequest } from "@/api/maps";
import { useJobsStore } from "@/store/jobs";
import { Button, Checkbox, Dialog, Field, Segmented, Select, toast } from "@/ui";
import { runTitle } from "./runModel";

type Content = MapExportRequest["content"];
type Format = MapExportRequest["formats"][number];

const FORMATS: { value: Format; label: string; hint: string; geo: boolean }[] = [
  { value: "geojson", label: "GeoJSON", hint: "WGS84 polygons, for web maps and most GIS tools", geo: true },
  {
    value: "gpkg",
    label: "GeoPackage",
    hint: "layers in the map's own coordinate system, for QGIS, ArcGIS, Civil 3D",
    geo: true,
  },
  {
    value: "csv",
    label: "CSV",
    hint: "one row per box: corners and centre in the map's system and in lat/lon",
    geo: false,
  },
];

/**
 * Starts a `map_export` job (spec section 9): every box as GeoJSON/GeoPackage/CSV with real-world
 * coordinates when the map has them, or the pixel CSV alone when it does not.
 */
export function ExportMapDialog({
  projectId,
  geoMap,
  runs,
  selectedRunId,
  onClose,
}: {
  projectId: string;
  geoMap: GeoMap;
  runs: MapRun[];
  selectedRunId: string | null;
  onClose: () => void;
}) {
  const api = useApi();
  const geo = !!geoMap.crs_wkt;
  const finished = runs.filter((r) => r.state === "succeeded");
  const [content, setContent] = useState<Content>(finished.length ? "run" : "labels");
  const [runId, setRunId] = useState(selectedRunId ?? finished[0]?.id ?? "");
  const [formats, setFormats] = useState<Format[]>(geo ? ["geojson", "gpkg", "csv"] : ["csv"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!formats.length) {
      setError("Choose at least one format.");
      return;
    }
    setBusy(true);
    try {
      const body: MapExportRequest = {
        map_id: geoMap.id,
        content,
        ...(content !== "labels" ? { run_id: runId } : {}),
        formats: FORMATS.map((f) => f.value).filter((f) => formats.includes(f)),
      };
      const job = await createMapExport(api, projectId, body);
      useJobsStore.getState().upsert(job);
      toast("info", "Export started: find it under Past exports on the Export screen when it is done.");
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
      title="Export boxes with coordinates"
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
        <Segmented
          label="What to export"
          value={content}
          onChange={setContent}
          options={[
            ...(finished.length
              ? [
                  { value: "run" as const, label: "Run detections" },
                  { value: "run_score" as const, label: "Run scored against labels" },
                ]
              : []),
            { value: "labels" as const, label: "Labels" },
          ]}
        />
        {content !== "labels" && (
          <Field label="Run" htmlFor="export-run">
            <Select id="export-run" value={runId} onChange={(e) => setRunId(e.target.value)}>
              {finished.map((r) => (
                <option key={r.id} value={r.id}>
                  {runTitle(r)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">Formats</legend>
          {FORMATS.map((f) => (
            <label key={f.value} className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={formats.includes(f.value)}
                disabled={f.geo && !geo}
                onChange={() =>
                  setFormats((cur) =>
                    cur.includes(f.value) ? cur.filter((x) => x !== f.value) : [...cur, f.value],
                  )
                }
                aria-label={f.label}
              />
              <span>
                <span className="text-ink">{f.label}</span> <span className="text-muted">— {f.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {!geo && (
          <p className="text-sm text-muted">
            This map has no coordinates, so only the CSV with pixel positions can be exported.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
