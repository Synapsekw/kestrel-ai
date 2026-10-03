import { useEffect, useState } from "react";
import type { AssetModel, AssetModelRun } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listRunPackages, type SiteModelPackage } from "@/api/plantItems";
import { phaseLabel, tokensText } from "@/assetmodels/run/runText";
import { RUN_POLL_MS, useLiveRun } from "@/assetmodels/run/useLiveRun";
import { Button, Disclosure, GlassPanel, Pill, Progress, toast, type PillTone } from "@/ui";

type PackageSummary = NonNullable<AssetModelRun["packages"]>;

/** Plain words for the plant run's stages (`usage_by_stage.current`); M1's phases come from `phaseLabel`. */
const STAGES: Record<string, string> = {
  survey: "Reading the drawings",
  trace: "Tracing packages",
  merge: "Merging items",
  cloud_check: "Checking against the scan",
  review: "Reviewing the scan check",
  environment: "Tracing land and sea",
  build: "Building the model",
  finish: "Finishing",
  done: "Done",
};
export function stageLabel(stage: string): string {
  const known = STAGES[stage] ?? phaseLabel(stage as AssetModelRun["phase"]);
  if (known) return known;
  const t = stage.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The plant run's current stage, else M1's phase. */
export function currentStage(run: AssetModelRun): string {
  return run.usage_by_stage?.current || run.phase;
}

/** "Estimated cost $7.25" (spec §8.4: an estimate, labelled so), or null without one. */
export function costText(run: AssetModelRun): string | null {
  const u = run.usage_by_stage;
  if (u?.cost_estimate_usd == null) return null;
  return `${u.cost_label || "Estimated cost"} $${u.cost_estimate_usd.toFixed(2)}`;
}

/** The run's own summary when present, else counted from the polled list. */
export function packageSummary(
  run: AssetModelRun,
  items: readonly SiteModelPackage[],
): PackageSummary | null {
  if (run.packages) return run.packages;
  if (items.length === 0) return null;
  const n = (s: string) => items.filter((k) => k.state === s).length;
  return { total: items.length, done: n("done"), failed: n("failed"), running: n("running") };
}
export function packagesText(s: PackageSummary): string {
  return [
    `${s.done} of ${s.total} packages`,
    s.running ? `${s.running} running` : null,
    s.failed ? `${s.failed} failed` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
const STATE_TONE: Record<string, PillTone> = {
  done: "ok",
  running: "accent",
  failed: "danger",
  queued: "neutral",
  skipped: "neutral",
};

/** Spec §11 Run (bottom, while a run is live): stage, package table, tokens, Stop. */
export function RunBar({ projectId, model }: { projectId: string; model: AssetModel }) {
  const api = useApi();
  const live = useLiveRun(projectId, model.id, model.live_run_id);
  const run = live.run;
  const runId = run?.id ?? null;
  const isRunning = run?.state === "running";
  const [pk, setPk] = useState<{ runId: string; items: SiteModelPackage[] } | null>(null);
  // Packages (≤ 64 rows) are polled every RUN_POLL_MS only while the run is running.
  useEffect(() => {
    if (!runId || !isRunning) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () =>
      listRunPackages(api, projectId, model.id, runId).then(
        (items) => {
          if (!alive) return;
          setPk({ runId, items });
          timer = setTimeout(tick, RUN_POLL_MS);
        },
        () => {
          if (alive) timer = setTimeout(tick, RUN_POLL_MS * 2);
        },
      );
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [api, projectId, model.id, runId, isRunning]);

  if (!run || !isRunning) return null;
  const items = pk?.runId === run.id ? pk.items : [];
  const summary = packageSummary(run, items);
  const share = summary && summary.total > 0 ? (summary.done + summary.failed) / summary.total : undefined;
  const cost = costText(run);
  return (
    <GlassPanel
      as="section"
      variant="float"
      radius="panel"
      aria-label="Run"
      className="pointer-events-auto flex w-full max-w-3xl flex-col gap-2 p-3 animate-reveal reduce-motion:animate-none"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Pill tone="accent" live>
          Running
        </Pill>
        <span className="text-sm font-semibold text-ink">{stageLabel(currentStage(run))}</span>
        {summary && (
          <span className="font-mono text-xs tabular-nums text-muted">{packagesText(summary)}</span>
        )}
        <span className="font-mono text-xs tabular-nums text-muted">{tokensText(run.usage)}</span>
        {cost && <span className="font-mono text-xs tabular-nums text-muted">{cost}</span>}
        <Button
          size="sm"
          variant="secondary"
          icon="x"
          className="ml-auto"
          disabled={live.stopping}
          onClick={() =>
            live.stop().catch((e: unknown) => toast("danger", messageOf(e, "The run could not be stopped.")))
          }
        >
          {live.stopping ? "Stopping…" : "Stop"}
        </Button>
      </div>
      <Progress thin running value={share} label="Run progress" />
      {items.length > 0 && (
        <Disclosure label="Packages" summary={String(items.length)}>
          <ul aria-label="Packages" className="flex max-h-48 flex-col overflow-y-auto">
            {items.map((k) => (
              <li key={k.id} className="flex items-center gap-2 py-1 text-xs">
                <span className="w-6 shrink-0 text-right font-mono tabular-nums text-dim">{k.n}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{k.label}</span>
                {k.area && <span className="shrink-0 text-dim">{k.area}</span>}
                <Pill size="sm" tone={STATE_TONE[k.state] ?? "neutral"}>
                  {k.state}
                </Pill>
                <span className="w-12 shrink-0 text-right font-mono tabular-nums text-muted">
                  {k.item_count}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </GlassPanel>
  );
}
