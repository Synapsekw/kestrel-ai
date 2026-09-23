import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { useProject } from "@/api/project";
import { updateMapDate, updateSource } from "@/api/sources";
import { ImportImagesDialog } from "@/data/ImportImagesDialog";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { ImportMapDialog } from "@/maps/ImportMapDialog";
import { SourceTable } from "@/sources/SourceTable";
import { buildRows, type SourceRow } from "@/sources/sourceRows";
import { useSources } from "@/sources/useSources";
import { Alert, Button, EmptyState, SkeletonRows } from "@/ui";

/**
 * A detection project's photo batches and maps in one list, newest survey first. Each carries its
 * survey date, which is edited in place, and the run it is counted by.
 */
export function SourcesScreen() {
  const { projectId = "" } = useParams();
  const api = useApi();
  const { project } = useProject(projectId);
  const { data, error, reload, replaceSource, replaceMap } = useSources(projectId);
  const [adding, setAdding] = useState<"photos" | "map" | null>(null);
  useOnJobsFinished("import", reload);
  useOnJobsFinished("map_import", reload);
  useOnJobsFinished("infer", reload);
  useOnJobsFinished("map_detect", reload);

  const rows = useMemo(() => (data ? buildRows(data.sources, data.maps, data.runs) : null), [data]);

  async function saveDate(row: SourceRow, capturedOn: string | null) {
    if (row.source) {
      replaceSource(await updateSource(api, projectId, row.source.id, { captured_on: capturedOn }));
    } else if (row.map) {
      replaceMap(await updateMapDate(api, projectId, row.map.id, capturedOn));
    }
  }

  const addButtons = (primary: boolean) => (
    <>
      <Button
        variant={primary ? "primary" : "secondary"}
        icon="import"
        onClick={() => setAdding("photos")}
        disabled={!project}
      >
        Add photos
      </Button>
      <Button icon="map" onClick={() => setAdding("map")}>
        Add a map
      </Button>
    </>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink">Sources</h1>
          <p className="mt-1 max-w-[65ch] text-sm text-muted">
            The photos and maps of this site. Each one is a survey, dated by when it was flown.
          </p>
        </div>
        {rows && rows.length > 0 && <div className="flex gap-2">{addButtons(false)}</div>}
      </div>

      {error && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}
      {!rows && !error && (
        <div className="mt-6">
          <SkeletonRows rows={3} columns={5} />
        </div>
      )}
      {rows && rows.length === 0 && (
        <EmptyState icon="images" title="No photos or maps yet" className="mt-6" action={addButtons(true)}>
          Add a folder of drone photos, or a GeoTIFF map of the site. The originals are only read, never
          changed.
        </EmptyState>
      )}
      {rows && rows.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <SourceTable projectId={projectId} rows={rows} onSaveDate={saveDate} />
        </div>
      )}

      {adding === "photos" && project && (
        <ImportImagesDialog
          project={project}
          onClose={() => setAdding(null)}
          onStarted={() => {
            setAdding(null);
            reload();
          }}
        />
      )}
      {adding === "map" && (
        <ImportMapDialog
          projectId={projectId}
          onClose={() => setAdding(null)}
          onStarted={() => {
            setAdding(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
