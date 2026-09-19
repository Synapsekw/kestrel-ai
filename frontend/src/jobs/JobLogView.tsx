import { Alert } from "@/ui";
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
    <div className="flex flex-col gap-2">
      {error && <Alert tone="danger">{error}</Alert>}
      <pre
        data-testid="jobcard-log"
        aria-label="Job log"
        className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-well p-3 font-mono text-xs text-ink"
      >
        {lines.length > 0 ? lines.map(readableLogLine).join("\n") : "(log is empty)"}
      </pre>
    </div>
  );
}
