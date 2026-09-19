import { readableLogLine } from "./logLines";
import { useJobLog } from "./useJobLog";

interface Props {
  projectId: string;
  jobId: string;
  live: boolean;
}

export function JobLogView({ projectId, jobId, live }: Props) {
  const { lines, error } = useJobLog(projectId, jobId, live);
  return (
    <div className="flex flex-col gap-1">
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      <pre
        data-testid="jobcard-log"
        aria-label="Job log"
        className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-2 font-mono text-xs text-slate-300"
      >
        {lines.length > 0 ? lines.map(readableLogLine).join("\n") : "(log is empty)"}
      </pre>
    </div>
  );
}
