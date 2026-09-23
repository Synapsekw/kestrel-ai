import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Source } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { REVIEW_QUEUE_QUERY } from "@/api/images";
import { chosenRun, listSourceRuns, reviewProgressText, type RunSummary } from "@/api/review";
import { fetchAllSources } from "@/api/sources";
import { pushLog } from "@/app/diagnostics";
import { useImageList } from "@/data/useImageList";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { Alert, Button, EmptyState, Field, Kbd, Pill, Progress, Select, Skeleton } from "@/ui";
import { AcceptAbove } from "./AcceptAbove";
import { ImageReviewQueue } from "./ImageReviewQueue";

const linkClass = "font-medium text-accent hover:underline";
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function sourceName(s: Source): string {
  if (s.label) return s.label;
  const parts = s.folder.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? s.folder;
}

/** Newest survey first; a source without a date goes after the dated ones, newest import first. */
function bySurvey(a: Source, b: Source): number {
  if (a.captured_on !== b.captured_on) {
    if (!a.captured_on) return 1;
    if (!b.captured_on) return -1;
    return a.captured_on < b.captured_on ? 1 : -1;
  }
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

function sourceOption(s: Source): string {
  const kind = s.kind === "map" ? "Map" : "Photos";
  const date = s.captured_on ? dateFormat.format(new Date(`${s.captured_on}T00:00:00`)) : "date not set";
  return `${sourceName(s)} · ${kind} · ${date}`;
}

/**
 * Review in a detection project (spec 2026-09-23 section 8): pick a source, and review the run that
 * counts for it (the pinned one, else the newest). Photos use the image queue and the editor; a map
 * opens the map viewer in review mode.
 */
export function DetectReview({ projectId }: { projectId: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const selectId = useId();
  const [params, setParams] = useSearchParams();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllSources(api, projectId)
      .then((items) => {
        if (!cancelled) setSources([...items].sort(bySurvey));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = messageOf(err, "could not load the sources");
        pushLog(`load sources failed: ${message}`);
        setError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);

  const wanted = params.get("source");
  const source = sources?.find((s) => s.id === wanted) ?? sources?.[0] ?? null;

  if (error) return <Alert tone="danger">{error}</Alert>;

  return (
    <section className="flex h-full min-h-0 flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Review</h1>
        <p className="text-sm text-muted">
          Accept, reject or correct what a model found. Verified numbers come from what you check here.
        </p>
      </div>

      {sources === null ? (
        <Skeleton className="h-9 w-80" />
      ) : sources.length === 0 || !source ? (
        <EmptyState icon="review" title="Nothing to review yet">
          Detections to check appear here after a model runs on your photos or a map.{" "}
          <Link to={`/p/${projectId}/sources`} className={linkClass}>
            Add photos or a map
          </Link>
          .
        </EmptyState>
      ) : (
        <>
          <Field label="Source" htmlFor={selectId} className="max-w-md">
            <Select
              id={selectId}
              value={source.id}
              onChange={(e) =>
                setParams((sp) => {
                  const next = new URLSearchParams(sp);
                  next.set("source", e.target.value);
                  return next;
                })
              }
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {sourceOption(s)}
                </option>
              ))}
            </Select>
          </Field>
          <SourceReview
            key={source.id}
            projectId={projectId}
            source={source}
            onOpenMap={(run) =>
              navigate(`/p/${projectId}/maps/${source.map_id}?mode=review&run=${encodeURIComponent(run.id)}`)
            }
          />
        </>
      )}
    </section>
  );
}

function SourceReview({
  projectId,
  source,
  onOpenMap,
}: {
  projectId: string;
  source: Source;
  onOpenMap: (run: RunSummary) => void;
}) {
  const api = useApi();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    listSourceRuns(api, projectId, source.id)
      .then((items) => {
        setRuns(items);
        setError(null);
      })
      .catch((err: unknown) => {
        const message = messageOf(err, "could not load the runs of this source");
        pushLog(`load source runs failed: ${message}`);
        setError(message);
      });
  }, [api, projectId, source.id]);
  useEffect(reload, [reload]);
  useOnJobsFinished("accept_above", reload);
  useOnJobsFinished("infer", reload);
  useOnJobsFinished("map_detect", reload);

  const run = useMemo(() => (runs ? chosenRun(runs) : null), [runs]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (runs === null) return <Skeleton className="h-16 w-full max-w-md" />;
  if (!run) {
    return (
      <EmptyState icon="detect" title="No run on this source yet">
        Run a model on it first, then check what it found here.{" "}
        <Link to={`/p/${projectId}/runs?source=${encodeURIComponent(source.id)}`} className={linkClass}>
          Run a model
        </Link>
      </EmptyState>
    );
  }

  const { total, reviewed } = run.review;
  const facts = (
    <div className="flex max-w-md flex-col gap-2" data-testid="review-run">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-ink">{run.model_name ?? "Unknown model"}</span>
        <span className="tabular-nums text-muted">at {Math.round(run.conf * 100)}% confidence</span>
        {run.pinned && (
          <Pill size="sm" tone="accent">
            Pinned
          </Pill>
        )}
        {run.job_state && run.job_state !== "succeeded" && (
          <Pill
            size="sm"
            tone={run.job_state === "failed" ? "danger" : "neutral"}
            live={run.job_state === "running"}
          >
            {run.job_state === "running" || run.job_state === "queued" ? "Still running" : "Did not finish"}
          </Pill>
        )}
      </div>
      <Progress value={total ? reviewed / total : 0} label="Reviewed" />
      <p className="text-xs tabular-nums text-muted">{reviewProgressText(reviewed, total)}</p>
    </div>
  );

  if (source.kind === "map") {
    return (
      <div className="flex flex-col gap-4">
        {facts}
        <p className="max-w-prose text-sm text-muted">
          Go through the survey on the map one detection at a time: <Kbd>A</Kbd> accepts, <Kbd>R</Kbd>{" "}
          rejects, <Kbd>1</Kbd>–<Kbd>9</Kbd> change the class and <Kbd>N</Kbd> moves on. You can also draw
          objects the model missed.
        </p>
        <div>
          <Button variant="primary" icon="map" disabled={!source.map_id} onClick={() => onOpenMap(run)}>
            Review on the map
          </Button>
        </div>
      </div>
    );
  }

  return <PhotoReview projectId={projectId} source={source} run={run} facts={facts} onDone={reload} />;
}

function PhotoReview({
  projectId,
  source,
  run,
  facts,
  onDone,
}: {
  projectId: string;
  source: Source;
  run: RunSummary;
  facts: ReactNode;
  onDone: () => void;
}) {
  // The run covers this source's images, so its suggestions are the source's pending ones: a
  // source filter keeps the request small where a list of every image id would not.
  const query = useMemo(() => ({ ...REVIEW_QUEUE_QUERY, source_id: source.id }), [source.id]);
  const list = useImageList(projectId, query);
  const reload = list.reload;
  useOnJobsFinished("accept_above", reload);
  return (
    <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="flex min-h-0 flex-col gap-4">
        {facts}
        <ImageReviewQueue
          projectId={projectId}
          list={list}
          empty={
            <EmptyState icon="review" title="Every photo is reviewed">
              No detections from this run are waiting.
            </EmptyState>
          }
        />
      </div>
      <aside className="flex flex-col gap-3 lg:border-l lg:border-line lg:pl-6">
        <h2 className="text-sm font-semibold text-ink">Accept in bulk</h2>
        <AcceptAbove
          projectId={projectId}
          runId={run.id}
          disabled={run.review.reviewed >= run.review.total}
          onDone={onDone}
        />
      </aside>
    </div>
  );
}
