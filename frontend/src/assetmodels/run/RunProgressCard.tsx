import type { AssetModel, AssetModelRun } from "@contract/client";
import { useBackend } from "@/api/client";
import { GlassPanel, Icon, Progress, StatusDot } from "@/ui";
import { phaseLabel, thumbUrl } from "./runText";
import { lastThumbStep, stepShare, stepText } from "./runView";

/**
 * Stands in for "No version yet" while the first run is live: what the agent is doing, how far it
 * is, and its latest render. Stop lives in the Build bar.
 */
export function RunProgressCard({
  projectId,
  model,
  run,
}: {
  projectId: string;
  model: AssetModel;
  run: AssetModelRun;
}) {
  const backend = useBackend();
  const thumb = lastThumbStep(run);
  const last = run.steps.at(-1);
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-6">
      <GlassPanel
        variant="float"
        radius="panel"
        data-testid="model-run-progress"
        className="pointer-events-auto flex w-full max-w-md flex-col gap-4 p-5 animate-pop reduce-motion:animate-none"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-ink">{`Building ${model.name}`}</h2>
          <p className="flex items-center gap-2 text-sm">
            <StatusDot status="running" live />
            <span className="text-ink">{phaseLabel(run.phase)}</span>
            <span className="font-mono text-xs tabular-nums text-muted">{stepText(run)}</span>
          </p>
        </div>
        {thumb ? (
          <img
            src={thumbUrl(backend.baseUrl, backend.token, projectId, model.id, run.id, thumb.n)}
            alt={`Step ${thumb.n} render`}
            className="aspect-[4/3] w-full rounded-control border border-line bg-bg object-contain"
          />
        ) : (
          <div
            aria-hidden="true"
            className="grid aspect-[4/3] w-full place-items-center rounded-control border border-line bg-surface-2"
          >
            <Icon name="cube" size={32} className="text-dim" />
          </div>
        )}
        <Progress running value={stepShare(run)} label="Run progress" />
        <p className="text-xs text-muted">
          {last?.summary ??
            "The agent is reading the sources. The first version opens here when it is saved."}
        </p>
      </GlassPanel>
    </div>
  );
}
