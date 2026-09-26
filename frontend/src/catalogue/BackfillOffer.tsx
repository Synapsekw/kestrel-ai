import { useState } from "react";
import { Link } from "react-router-dom";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { backfillRunningJobId, isBackfillRunning, startBackfill, type CatalogueType } from "@/api/catalogue";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, buttonClass } from "@/ui";

/** F §7.2: after object → defect, offer D6's rule for this type (a `findings_backfill` library job). */
export function BackfillOffer({ type, onDismiss }: { type: CatalogueType; onDismiss: () => void }) {
  const api = useApi();
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set only for a 409 `job_running`: where "Follow in Jobs" should point (controller ruling P13).
  const [runningLink, setRunningLink] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    setRunningLink(null);
    try {
      const started = await startBackfill(api, type.id);
      useJobsStore.getState().upsert(started);
      setJob(started);
    } catch (e) {
      pushLog(`start backfill failed: ${messageOf(e, String(e))}`);
      if (isBackfillRunning(e)) {
        const jobId = backfillRunningJobId(e);
        setRunningLink(jobId ? `/jobs?project=library&job=${jobId}` : "/jobs");
        setError("A backfill of this type is already running");
      } else {
        // 422 `not_a_defect` and anything else: the server's own message (controller ruling P13).
        setError(messageOf(e, "could not start the backfill"));
      }
    } finally {
      setBusy(false);
    }
  }

  if (job) {
    return (
      <Alert
        tone="ok"
        title="Creating findings in the background"
        onDismiss={onDismiss}
        actions={
          <Link to={`/jobs?project=library&job=${job.id}`} className={buttonClass("secondary", "sm")}>
            Follow in Jobs
          </Link>
        }
      >
        Every recent project is checked in turn. Boxes that already have a finding are skipped.
      </Alert>
    );
  }
  return (
    <Alert
      tone="info"
      title={`${type.name} is now a defect`}
      onDismiss={onDismiss}
      actions={
        <Button size="sm" variant="primary" loading={busy} onClick={() => void start()}>
          Create findings from accepted annotations of this type
        </Button>
      }
    >
      Accepted boxes of this type in your projects can become findings, marked Reviewed with no severity.
      Nothing changes until you choose to.
      {error && (
        <span role="alert" className="mt-1 block text-danger">
          {error}
          {runningLink && (
            <>
              {" "}
              <Link to={runningLink} className="underline">
                Follow in Jobs
              </Link>
            </>
          )}
        </span>
      )}
    </Alert>
  );
}
