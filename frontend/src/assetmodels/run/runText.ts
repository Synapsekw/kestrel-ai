import type { AssetModelRun } from "@contract/client";

const PHASES: Record<AssetModelRun["phase"], string> = {
  sampling: "Sampling the scan",
  reading: "Reading sources",
  building: "Building",
  checking: "Checking",
  done: "Done",
};

export const phaseLabel = (p: AssetModelRun["phase"]) => PHASES[p];

export function stopReasonText(run: Pick<AssetModelRun, "state" | "stop_reason">): string | null {
  if (run.state === "finished" || run.state === "running") return null;
  switch (run.stop_reason) {
    case "budget":
      return "Stopped: the run used its budget";
    case "timeout":
      return "Stopped: the run reached its 20-minute limit";
    case "user":
      return "Stopped by you";
    case "interrupted":
      return "Interrupted when the app closed";
    case "provider_error":
      return "The AI provider returned an error";
    default:
      return "The run did not finish";
  }
}

export function tokensText(u: AssetModelRun["usage"]): string {
  const t = u.input_tokens + u.output_tokens;
  return t >= 1_000_000 ? `${(t / 1_000_000).toFixed(1)} M tokens` : `${(t / 1000).toFixed(1)} k tokens`;
}

export function thumbUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  modelId: string,
  runId: string,
  n: number,
): string {
  const p = `/api/v1/projects/${encodeURIComponent(projectId)}/asset-models/${encodeURIComponent(modelId)}`;
  return `${baseUrl.replace(/\/$/, "")}${p}/runs/${encodeURIComponent(runId)}/steps/${n}/thumb?token=${encodeURIComponent(token)}`;
}
