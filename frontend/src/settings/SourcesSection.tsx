import { useCallback, useEffect, useState } from "react";
import type { Source, Stats } from "@contract/client";
import { useApi } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import { createSource, fetchAllSources, fetchSourceStats } from "@/api/sources";
import { pushLog } from "@/app/diagnostics";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { formatDate, formatLocalDate } from "@/library/modelLabels";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, Skeleton } from "@/ui";

interface ListState {
  key: string;
  sources: Source[];
  unavailable: boolean;
  error: string | null;
}

function StatsSummary({ stats }: { stats: Stats }) {
  const res = stats.resolution_histogram
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((r) => `${r.width}x${r.height} (${r.count})`)
    .join(", ");
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs tabular-nums text-muted md:grid-cols-3">
      <div>
        {stats.labeled_count} labeled, {stats.unlabeled_count} unlabeled
      </div>
      <div>
        {stats.box_count} boxes, {stats.pending_review_count} pending review
      </div>
      <div>
        {stats.groups.length} groups, {stats.duplicate_count} duplicates skipped
      </div>
      <div className="md:col-span-2">Resolutions: {res || "none"}</div>
      <div>
        {stats.capture_time_range
          ? `Captured ${formatDate(stats.capture_time_range.min)} to ${formatDate(stats.capture_time_range.max)}`
          : "No capture times"}
      </div>
    </dl>
  );
}

function SourceRow({
  projectId,
  source,
  onReimported,
}: {
  projectId: string;
  source: Source;
  onReimported: () => void;
}) {
  const api = useApi();
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reimportJobId, setReimportJobId] = useState<string | null>(null);
  const { job } = useTrackedJob(projectId, reimportJobId);
  // The counts only change once the import job has actually run, so the re-list waits for it.
  const finished = job !== null && !isActiveJob(job);

  useEffect(() => {
    if (finished) onReimported();
  }, [finished, onReimported]);

  async function loadStats() {
    setBusy(true);
    setError(null);
    try {
      setStats(await fetchSourceStats(api, projectId, source.id));
    } catch (e) {
      pushLog(`source stats ${source.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not load the statistics"));
    } finally {
      setBusy(false);
    }
  }

  async function reimport() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await createSource(api, projectId, {
        folder: source.folder,
        site: source.site,
        settings: source.settings,
      });
      useJobsStore.getState().upsert(result.job);
      useJobsStore.getState().setPanelOpen(true);
      setReimportJobId(result.job.id);
      setStatus(`Re-import started (job ${result.job.id.slice(0, 8)})`);
    } catch (e) {
      pushLog(`re-import ${source.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not start the re-import"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">{source.site}</span>
        <span className="truncate font-mono text-xs text-muted">{source.folder}</span>
        <span className="text-xs tabular-nums text-muted">
          {source.image_count} images, {source.duplicate_count} duplicates
          {source.imported_at ? `, imported ${formatLocalDate(source.imported_at)}` : ", not imported yet"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => void loadStats()}
          disabled={busy}
        >
          Stats
        </Button>
        <Button size="sm" icon="import" onClick={() => void reimport()} disabled={busy}>
          Re-import new files
        </Button>
      </div>
      {stats && <StatsSummary stats={stats} />}
      {status && (
        <p role="status" className="text-xs text-ok">
          {status}
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </li>
  );
}

/** Spec section 5: imported folders with their counts and per-source statistics; re-import picks up new files only. */
export function SourcesSection({ projectId }: { projectId: string }) {
  const api = useApi();
  const [state, setState] = useState<ListState>({
    key: "",
    sources: [],
    unavailable: false,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const key = `${projectId}|${attempt}`;
  const reload = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetchAllSources(api, projectId)
      .then((sources) => {
        if (!cancelled) setState({ key, sources, unavailable: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load sources failed: ${messageOf(e, String(e))}`);
        const unavailable = isNotImplemented(e);
        // A failed re-list keeps the sources already on screen; only the error line is new.
        setState((prev) => ({
          key,
          sources: unavailable ? [] : prev.sources,
          unavailable,
          error: unavailable ? null : messageOf(e, "could not load sources"),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key]);

  const loaded = state.key === key;
  return (
    <section data-testid="sources-section" className="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Sources</h2>
        <p className="text-sm text-muted">
          Imported folders. Import a new folder from Images; re-import a folder to pick up files added since.
        </p>
      </div>
      {!loaded && state.sources.length === 0 && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {loaded && state.unavailable && (
        <p role="note" className="text-xs text-muted">
          Sources are not available yet (they arrive with the dataset backend).
        </p>
      )}
      {loaded && state.error && <Alert tone="danger">{state.error}</Alert>}
      {loaded && !state.unavailable && !state.error && state.sources.length === 0 && (
        <p className="text-sm text-muted">No sources yet.</p>
      )}
      {state.sources.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
          {state.sources.map((s) => (
            <SourceRow
              // Remounting on changed counts drops the row's cached statistics, which are now stale.
              key={`${s.id}|${s.image_count}|${s.duplicate_count}|${s.imported_at ?? ""}`}
              projectId={projectId}
              source={s}
              onReimported={reload}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
