import type { AssetModelRun } from "@contract/client";
import type { ToastTone } from "@/ui/toastStore";
import { stopReasonText } from "./runText";

/** The agent's step budget: a run ends at the latest after this many steps (spec §6). */
export const MAX_STEPS = 80;

/** "step 12 of 80" */
export const stepText = (run: Pick<AssetModelRun, "steps">) =>
  `step ${Math.min(run.steps.length, MAX_STEPS)} of ${MAX_STEPS}`;

/** The run's share of its step budget, 0 to 1. */
export const stepShare = (run: Pick<AssetModelRun, "steps">) =>
  Math.min(run.steps.length, MAX_STEPS) / MAX_STEPS;

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
