import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Job, Source } from "@contract/client";
import { useApi } from "@/api/client";
import { createDetectExport } from "@/api/detectExports";
import { messageOf } from "@/api/errors";
import { fetchAllSources } from "@/api/sources";
import { sortSources } from "@/analytics/format";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, buttonClass, Field, Select } from "@/ui";

interface Props {
  projectId: string;
  onStarted?: (job: Job) => void;
}

const CSV_HINT =
  "One row per source, class and site area, with the total and the verified count. Opens in Excel.";

const ALL = "";

const sourceName = (s: Source) =>
  `${s.label ?? s.folder} (${s.kind === "map" ? "map" : "photos"}${s.captured_on ? `, ${s.captured_on}` : ""})`;

/** A project's counts as a CSV table; the per-source PDF is a Survey count report now (reports spec §13). */
export function DetectExportForm({ projectId, onStarted }: Props) {
  const api = useApi();
  const [sourceId, setSourceId] = useState(ALL);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = useMemo(() => sortSources(sources ?? []), [sources]);

  useEffect(() => {
    let cancelled = false;
    fetchAllSources(api, projectId)
      .then((s) => {
        if (!cancelled) setSources(s);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load sources for export failed: ${messageOf(e, String(e))}`);
        setLoadError(messageOf(e, "could not load the sources"));
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const job = await createDetectExport(
        api,
        projectId,
        sourceId === ALL ? { format: "csv" } : { format: "csv", source_id: sourceId },
      );
      useJobsStore.getState().upsert(job);
      onStarted?.(job);
    } catch (e) {
      pushLog(`create detection export failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not start the export"));
    } finally {
      setBusy(false);
    }
  }

  const empty = sources !== null && sources.length === 0;

  return (
    <section
      aria-label="Counts"
      className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Counts</h2>
        <p className="max-w-prose text-sm text-muted">
          Maps count objects. Photos count detections, and the same object can appear in several photos.
        </p>
      </div>
      <p className="max-w-prose text-xs leading-relaxed text-muted">Table (CSV). {CSV_HINT}</p>
      <Field label="Sources" htmlFor="detect-export-source" className="max-w-sm">
        <Select
          id="detect-export-source"
          value={sourceId}
          disabled={sources === null || empty}
          onChange={(e) => setSourceId(e.target.value)}
        >
          <option value={ALL}>All sources</option>
          {sorted.map((s) => (
            <option key={s.id} value={s.id}>
              {sourceName(s)}
            </option>
          ))}
        </Select>
      </Field>
      {empty && <p className="text-sm text-muted">Add photos or a map and run a model over them first.</p>}
      {loadError && <Alert tone="danger">{loadError}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <Button
        variant="primary"
        icon="download"
        loading={busy}
        disabled={empty}
        onClick={() => void submit()}
        className="self-start"
      >
        Export
      </Button>
      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <p className="max-w-prose text-sm text-muted">
          A printable report of the counts, with an overview picture per source, is a report now.
        </p>
        <Link
          to={`/p/${projectId}/reports?new=builtin-survey-counts`}
          className={buttonClass("secondary", "md", "w-fit")}
        >
          Create a Survey count report
        </Link>
      </div>
    </section>
  );
}
