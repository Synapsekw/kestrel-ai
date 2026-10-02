import { useState } from "react";
import type { AssetModel, AssetModelRun } from "@contract/client";
import { useBackend } from "@/api/client";
import { Button, GlassPanel, Icon, Progress, Skeleton, StatusDot, cx } from "@/ui";
import { BuildDialog, type BuildInitial, type RunMode } from "./BuildDialog";
import { phaseLabel, stopReasonText, thumbUrl } from "./runText";
import { draftText, endedEarly, lastThumbStep, stepShare, stepText, tryAgainOf } from "./runView";

export interface BuildBarProps {
  projectId: string;
  model: AssetModel;
  onStarted(run: AssetModelRun): void;
  /** The live run, or null when none runs. */
  run: AssetModelRun | null;
  onStop(): void;
  stopping: boolean;
  /** The latest ended run: when it stopped or failed, the bar says why and offers Try again. */
  lastRun?: AssetModelRun | null;
  /** A live run is known but not read yet. */
  loading?: boolean;
  /** The live run could not be read. */
  error?: string | null;
}

/** The step's thumbnail at 64px, or a quiet placeholder until the agent renders one. */
function StepThumb({ projectId, run }: { projectId: string; run: AssetModelRun }) {
  const backend = useBackend();
  const step = lastThumbStep(run);
  if (!step)
    return (
      <span aria-hidden="true" className="grid h-16 w-16 shrink-0 place-items-center rounded-sm bg-surface-2">
        <Icon name="cube" size={20} className="text-dim" />
      </span>
    );
  return (
    <img
      src={thumbUrl(backend.baseUrl, backend.token, projectId, run.model_id, run.id, step.n)}
      alt={`Step ${step.n} preview`}
      className="h-16 w-16 shrink-0 rounded-sm border border-line bg-bg object-cover"
    />
  );
}

function LiveRun({
  projectId,
  run,
  onStop,
  stopping,
}: {
  projectId: string;
  run: AssetModelRun;
  onStop(): void;
  stopping: boolean;
}) {
  const last = run.steps.at(-1);
  return (
    <div className="flex items-center gap-3">
      <StepThumb projectId={projectId} run={run} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="flex items-center gap-2 text-sm">
          <StatusDot status="running" live />
          <span className="font-semibold text-ink">{phaseLabel(run.phase)}</span>
          <span className="font-mono text-xs tabular-nums text-muted">{stepText(run)}</span>
        </p>
        <Progress thin running value={stepShare(run)} label="Run progress" />
        <p className="truncate text-xs text-muted" title={last?.summary}>
          {last?.summary ?? (run.mode === "refine" ? "Starting the refine…" : "Starting the build…")}
        </p>
      </div>
      <Button variant="danger" size="sm" loading={stopping} onClick={onStop}>
        Stop
      </Button>
    </div>
  );
}

/**
 * The Build bar under the viewer (M1 spec §8): Build with AI… and Refine… when idle; while a run is
 * live its phase, step, progress, latest thumbnail and Stop; after a run that stopped or failed, why,
 * and Try again with that run's choices.
 */
export function BuildBar({
  projectId,
  model,
  onStarted,
  run,
  onStop,
  stopping,
  lastRun,
  loading,
  error,
}: BuildBarProps) {
  const [dialog, setDialog] = useState<{ mode: RunMode; initial?: BuildInitial; key: number } | null>(null);
  const openDialog = (mode: RunMode, initial?: BuildInitial) =>
    setDialog((d) => ({ mode, initial, key: (d?.key ?? 0) + 1 }));
  const live = run?.state === "running" ? run : null;
  const ended = !live && lastRun && endedEarly(lastRun) ? lastRun : null;
  const canRefine = model.current_version != null;

  let body;
  if (live) body = <LiveRun projectId={projectId} run={live} onStop={onStop} stopping={stopping} />;
  else if (loading)
    body = (
      <div role="status" aria-label="Reading the run" className="flex items-center gap-3">
        <Skeleton className="h-16 w-16 rounded-sm" />
        <Skeleton className="h-4 w-60" />
      </div>
    );
  else
    body = (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {ended && (
          <div className="mr-auto flex min-w-0 items-center gap-2 text-sm">
            <Icon
              name="warning"
              size={15}
              className={ended.state === "failed" ? "shrink-0 text-danger" : "shrink-0 text-warn"}
            />
            <span className="min-w-0">
              <span className="text-ink">{stopReasonText(ended)}</span>
              {draftText(ended) && <span className="text-muted">{` · ${draftText(ended)}`}</span>}
            </span>
          </div>
        )}
        {error && <p className="mr-auto text-xs text-danger">{`The run could not be read: ${error}`}</p>}
        <div className="flex items-center gap-2">
          {ended && (
            <Button
              variant="primary"
              size="sm"
              icon="refresh"
              onClick={() => {
                const { mode, initial } = tryAgainOf(ended, canRefine);
                openDialog(mode, initial);
              }}
            >
              Try again
            </Button>
          )}
          <Button
            variant={ended ? "secondary" : "primary"}
            size="sm"
            icon="sparkle"
            onClick={() => openDialog("build")}
          >
            Build with AI…
          </Button>
          {canRefine && (
            <Button variant="secondary" size="sm" onClick={() => openDialog("refine")}>
              Refine…
            </Button>
          )}
        </div>
      </div>
    );

  return (
    <>
      <GlassPanel
        variant="float"
        radius="panel"
        as="section"
        data-testid="model-build-bar"
        aria-label="Build"
        className={cx(
          "pointer-events-auto mx-auto max-w-full px-3 py-2.5 animate-reveal reduce-motion:animate-none",
          live || loading ? "w-[560px]" : "w-fit",
        )}
      >
        {body}
      </GlassPanel>
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
    </>
  );
}
