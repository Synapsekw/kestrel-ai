import type { AssetModelRun } from "@contract/client";
import type { ToastTone } from "@/ui/toastStore";
import type { BuildInitial } from "./BuildDialog";
import { stopReasonText } from "./runText";

/** M1's tool-call budget (backend runner.py MAX_CALLS) for build and refine runs. */
export const DEFAULT_MAX_STEPS = 80;

type Budgeted = Pick<AssetModelRun, "mode">;

/**
 * The run's step budget (spec �11): M1's 80 for build and refine; null for plant runs, which are
 * counted in packages (Ruling 12).
 */
export function maxSteps(run: Budgeted): number | null {
  return run.mode === "build" || run.mode === "refine" ? DEFAULT_MAX_STEPS : null;
}

/** "step 12 of 80", or "step 12" without a budget. */
export function stepText(run: Budgeted & Pick<AssetModelRun, "steps">): string {
  const max = maxSteps(run);
  const n = run.steps.length;
  return max === null ? `step ${n}` : `step ${Math.min(n, max)} of ${max}`;
}

/** The run's share of its step budget, 0 to 1; undefined (an indeterminate bar) without a budget. */
export function stepShare(run: Budgeted & Pick<AssetModelRun, "steps">): number | undefined {
  const max = maxSteps(run);
  return max === null ? undefined : Math.min(run.steps.length, max) / max;
}

/** The latest step that rendered a thumbnail, or null. */
export function lastThumbStep(run: Pick<AssetModelRun, "steps">) {
  for (let i = run.steps.length - 1; i >= 0; i -= 1) if (run.steps[i].has_thumb) return run.steps[i];
  return null;
}

/** True for a run that ended without finishing (stopped or failed): the bar offers Try again. */
export const endedEarly = (run: Pick<AssetModelRun, "state">) =>
  run.state === "stopped" || run.state === "failed";

/** "Saved a draft as version 3" for an early end that still wrote one, else null. */
export const draftText = (run: Pick<AssetModelRun, "state" | "version">) =>
  endedEarly(run) && run.version != null ? `Saved a draft as version ${run.version}` : null;

/** The one toast for a run that just ended: what it wrote, or why it stopped. */
export function runEndToast(run: AssetModelRun): { tone: ToastTone; text: string } {
  if (run.state === "finished")
    return run.version != null
      ? { tone: "ok", text: `Built version ${run.version}` }
      : { tone: "info", text: "The run finished without changes" };
  const draft = draftText(run);
  if (draft) return { tone: "info", text: draft };
  return {
    tone: run.state === "failed" ? "danger" : "info",
    text: stopReasonText(run) ?? "The run did not finish",
  };
}

/** Try again: the ended run's mode (refine only while the model has a version), sources, agent and notes. */
export function tryAgainOf(
  run: Pick<AssetModelRun, "mode" | "sources" | "provider" | "model_name" | "notes">,
  canRefine: boolean,
): { mode: AssetModelRun["mode"]; initial: BuildInitial } {
  return {
    mode: run.mode === "refine" && canRefine ? "refine" : "build",
    initial: { sources: run.sources, provider: run.provider, model_name: run.model_name, notes: run.notes },
  };
}
