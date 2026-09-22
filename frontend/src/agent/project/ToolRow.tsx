import type { AgentItem, AgentToolStatus, Job } from "@contract/client";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Disclosure, Icon, Pill, Progress, type IconName, type PillTone } from "@/ui";

const STATUS: Record<AgentToolStatus, { tone: PillTone; text: string; live?: boolean }> = {
  running: { tone: "accent", text: "Running", live: true },
  ok: { tone: "ok", text: "Done" },
  error: { tone: "danger", text: "Failed" },
  denied: { tone: "neutral", text: "Declined" },
  awaiting_approval: { tone: "warn", text: "Needs approval" },
};

const JOB_NAME: Record<Job["type"], string> = {
  import: "Import",
  dataset: "Dataset build",
  train: "Training",
  infer: "Labeling",
  export: "Export",
  results_export: "Results export",
};

/** An icon for the kind of work, by the tool name's leading verb or subject. */
function toolIcon(name: string): IconName {
  if (name === "open_screen") return "arrow-right";
  if (name.startsWith("delete_")) return "trash";
  if (name.includes("train")) return "train";
  if (name.includes("label") || name.includes("box") || name.includes("suggestion")) return "label";
  if (name.includes("dataset")) return "datasets";
  if (name.includes("model")) return "models";
  if (name.includes("export")) return "download";
  if (name.includes("import")) return "import";
  if (name.includes("image")) return "images";
  if (name.includes("job")) return "jobs";
  return "search";
}

/** `label_images` → "Label images". */
function humanTool(name: string | null): string {
  if (!name) return "Tool";
  const words = name.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function JobProgress({ jobId }: { jobId: string }) {
  const job = useJobsStore((s) => s.jobs[jobId]);
  if (!job) return null;
  const active = isActiveJob(job);
  const name = JOB_NAME[job.type];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted">
        <span className="min-w-0 truncate">{job.message ? `${name}: ${job.message}` : name}</span>
        <span className="shrink-0 tabular-nums">
          {job.state === "succeeded"
            ? "Finished"
            : job.state === "failed"
              ? "Failed"
              : job.state === "cancelled"
                ? "Cancelled"
                : `${Math.round(job.progress * 100)}%`}
        </span>
      </div>
      <Progress value={job.progress} running={active} label={`${name} progress`} thin />
    </div>
  );
}

/** One compact row per tool call: what it did, its status, its input on demand and live job progress. */
export function ToolRow({ item }: { item: AgentItem }) {
  const status = item.tool_status ? STATUS[item.tool_status] : null;
  const label = item.tool_summary || humanTool(item.tool_name);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line px-3 py-2">
      <div className="flex items-start gap-2">
        <Icon name={toolIcon(item.tool_name ?? "")} size={14} className="mt-0.5 text-muted" />
        <p className="min-w-0 flex-1 break-words text-[13px] leading-relaxed">{label}</p>
        {status && (
          <Pill size="sm" tone={status.tone} live={status.live}>
            {status.text}
          </Pill>
        )}
      </div>
      {item.job_ids.map((id) => (
        <JobProgress key={id} jobId={id} />
      ))}
      {item.tool_input && (
        <Disclosure label="Details">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-well px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted">
            {JSON.stringify(item.tool_input, null, 2)}
          </pre>
        </Disclosure>
      )}
    </div>
  );
}
