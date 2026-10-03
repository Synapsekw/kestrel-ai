import { useState } from "react";
import { Link } from "react-router-dom";
import type { AssetModel, AssetModelRun } from "@contract/client";
import { useBackend } from "@/api/client";
import { providerLabel } from "@/api/providers";
import { relativeTime } from "@/findings/format";
import { useNow } from "@/jobs/useNow";
import { siteHref } from "@/site3d/entry/links";
import {
  Button,
  Disclosure,
  EmptyState,
  Pill,
  StatusDot,
  Tooltip,
  cx,
  focusRing,
  transition,
  type PillTone,
} from "@/ui";
import { BuildDialog, type BuildInitial, type RunMode } from "./BuildDialog";
import { phaseLabel, stopReasonText, thumbUrl, tokensText } from "./runText";
import { draftText } from "./runView";

const STATE: Record<AssetModelRun["state"], { label: string; tone: PillTone }> = {
  running: { label: "Running", tone: "accent" },
  finished: { label: "Finished", tone: "ok" },
  stopped: { label: "Stopped", tone: "warn" },
  failed: { label: "Failed", tone: "danger" },
};
const MODE: Record<RunMode, string> = {
  build: "Build",
  refine: "Refine",
  plant: "Plant build",
  plant_package: "Package re-run",
};

const when = (iso: string, now: number) => relativeTime(iso, now).replace(/ /g, " ");

function Step({
  projectId,
  run,
  step,
}: {
  projectId: string;
  run: AssetModelRun;
  step: AssetModelRun["steps"][number];
}) {
  const backend = useBackend();
  const row = (
    <span className="flex w-full min-w-0 items-baseline gap-2">
      <span className="w-6 shrink-0 text-right font-mono text-2xs tabular-nums text-dim">{step.n}</span>
      <StatusDot status={step.ok ? "closed" : "failed"} className="h-1.5 w-1.5 shrink-0 translate-y-[-1px]" />
      <span className="shrink-0 font-mono text-2xs text-muted">{step.tool}</span>
      <span className="min-w-0 truncate text-xs text-ink">{step.summary}</span>
    </span>
  );
  return (
    <li
      aria-label={`Step ${step.n}: ${step.tool}, ${step.ok ? "ok" : "failed"}`}
      className="rounded-sm px-1 py-1 hover:bg-hover"
    >
      {step.has_thumb ? (
        <Tooltip
          side="left"
          className="w-full min-w-0"
          label={
            <img
              src={thumbUrl(backend.baseUrl, backend.token, projectId, run.model_id, run.id, step.n)}
              alt={`Step ${step.n} render`}
              className="h-40 w-40 rounded-sm bg-bg object-contain"
            />
          }
        >
          {row}
        </Tooltip>
      ) : (
        row
      )}
    </li>
  );
}

/**
 * The inspector's Run tab (M1 spec §8): the picked run (the latest by default) with its state,
 * provider and model, timing, tokens and summary, its open questions (each can seed a refine) and its
 * steps; older runs under "Earlier runs".
 */
export function RunTab({
  projectId,
  model,
  runs,
  onStarted,
}: {
  projectId: string;
  model: AssetModel;
  /** Newest first. */
  runs: AssetModelRun[];
  onStarted(run: AssetModelRun): void;
}) {
  const now = useNow(30_000);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: RunMode; initial: BuildInitial; key: number } | null>(null);
  const run = runs.find((r) => r.id === pickedId) ?? runs[0] ?? null;
  if (!run)
    return (
      <EmptyState icon="sparkle" title="No runs yet">
        Build with AI… reads the drawings, clouds and photos you pick and saves the model as a version.
      </EmptyState>
    );

  const state = STATE[run.state];
  const reason = stopReasonText(run);
  const draft = draftText(run);
  const total = run.usage.input_tokens + run.usage.output_tokens;
  const earlier = runs.slice(1);
  const refineMode: RunMode = model.current_version != null ? "refine" : "build";

  return (
    <div className="flex flex-col gap-4 p-1">
      <section aria-label="Run" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={state.tone} live={run.state === "running"} dot={run.state !== "running"}>
            {state.label}
          </Pill>
          <span className="text-sm font-semibold text-ink">{MODE[run.mode]}</span>
          {run.version != null && <span className="font-mono text-xs text-muted">{`v${run.version}`}</span>}
          {run.id !== runs[0].id && (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setPickedId(null)}>
              Latest run
            </Button>
          )}
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted">Agent</dt>
          <dd className="min-w-0 truncate text-ink">
            {providerLabel(run.provider)} · <span className="font-mono">{run.model_name}</span>
          </dd>
          <dt className="text-muted">Started</dt>
          <dd className="text-ink">{when(run.started_at, now)}</dd>
          {run.ended_at && (
            <>
              <dt className="text-muted">Ended</dt>
              <dd className="text-ink">{when(run.ended_at, now)}</dd>
            </>
          )}
          {run.state === "running" && (
            <>
              <dt className="text-muted">Phase</dt>
              <dd className="text-ink">{phaseLabel(run.phase)}</dd>
            </>
          )}
          {total > 0 && (
            <>
              <dt className="text-muted">Usage</dt>
              <dd className="font-mono tabular-nums text-ink">
                <span>{tokensText(run.usage)}</span>
              </dd>
            </>
          )}
        </dl>
        {(reason || draft) && (
          <p className={cx("text-xs", run.state === "failed" ? "text-danger" : "text-warn")}>
            {[reason, draft].filter(Boolean).join(" · ")}
          </p>
        )}
        {run.summary && <p className="text-sm leading-relaxed text-ink">{run.summary}</p>}
        {run.state === "finished" && run.version != null && model.kind === "plant" && (
          <Link
            to={siteHref(projectId, model.id)}
            className="self-start text-sm text-accent-ink underline-offset-2 hover:underline"
          >
            Open in site
          </Link>
        )}
      </section>

      {run.open_questions.length > 0 && (
        <section aria-label="Open questions" className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted">Open questions</h3>
          <ul className="flex flex-col gap-2">
            {run.open_questions.map((q, i) => (
              <li
                key={i}
                className="flex flex-col items-start gap-1 rounded-control border border-line bg-surface p-2"
              >
                <p className="text-sm text-ink">{q}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="sparkle"
                  className="-ml-1.5"
                  onClick={() =>
                    setDialog((d) => ({ mode: refineMode, initial: { notes: q }, key: (d?.key ?? 0) + 1 }))
                  }
                >
                  Refine with this note…
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Steps" className="flex flex-col gap-1">
        <h3 className="text-xs font-medium text-muted">
          Steps <span className="font-mono text-2xs tabular-nums text-dim">{run.steps.length}</span>
        </h3>
        {run.steps.length === 0 ? (
          <p className="text-xs text-dim">No steps yet.</p>
        ) : (
          <ol className="flex flex-col">
            {run.steps.map((s) => (
              <Step key={s.n} projectId={projectId} run={run} step={s} />
            ))}
          </ol>
        )}
      </section>

      {earlier.length > 0 && (
        <Disclosure label="Earlier runs" summary={String(earlier.length)}>
          <ul aria-label="Earlier runs" className="flex flex-col">
            {earlier.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  aria-current={r.id === run.id || undefined}
                  onClick={() => setPickedId(r.id)}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-xs hover:bg-hover",
                    r.id === run.id && "bg-accent-soft",
                    transition,
                    focusRing,
                  )}
                >
                  <span className="text-ink">{MODE[r.mode]}</span>
                  <span className="text-muted">{STATE[r.state].label}</span>
                  {r.version != null && <span className="font-mono text-muted">{`v${r.version}`}</span>}
                  <span className="ml-auto text-dim">{when(r.started_at, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      {dialog && (
        <BuildDialog
          key={dialog.key}
          open
          projectId={projectId}
          model={model}
          mode={dialog.mode}
          initial={dialog.initial}
          onClose={() => setDialog(null)}
          onStarted={(r) => {
            setDialog(null);
            onStarted(r);
          }}
        />
      )}
    </div>
  );
}
