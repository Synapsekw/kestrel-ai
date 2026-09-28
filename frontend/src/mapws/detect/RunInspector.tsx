import { useCallback, useEffect, useState } from "react";
import type { MapRun } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchMapRun } from "@/api/maps";
import { pushLog } from "@/app/diagnostics";
import { stateLabel } from "@/jobs/jobLabels";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import type { InspectorBodyProps } from "@/mapws/w4host";
import { AcceptAbove } from "@/review/AcceptAbove";
import {
  Alert,
  Button,
  InspectorPane,
  InspectorSection,
  KeyChord,
  Pill,
  Progress,
  useToolShortcuts,
} from "@/ui";
import { useDetectStore } from "./detectStore";
import { useReview } from "./useReview";

/** `sel=run:<id>` (DetectReview's link, and a region run while it runs): progress, then the start of review. */
export function RunInspector({ selection, projectId, onClose }: InspectorBodyProps) {
  const api = useApi();
  const review = useReview(projectId);
  // Keyed by run id so a stale run never shows for a new selection.
  const [loaded, setLoaded] = useState<{ runId: string; run: MapRun | null; error: string | null } | null>(
    null,
  );
  const [tick, setTick] = useState(0);
  const onFinished = useCallback(() => setTick((t) => t + 1), []);
  useOnJobsFinished("map_detect", onFinished);
  const current = loaded?.runId === selection.id ? loaded : null;
  const run = current?.run ?? null;
  const running = run?.state === "running" || run?.state === "queued";
  const { job } = useTrackedJob(projectId, running ? run.job_id : null);

  useEffect(() => {
    let cancelled = false;
    const runId = selection.id;
    fetchMapRun(api, projectId, runId)
      .then((r) => !cancelled && setLoaded({ runId, run: r, error: null }))
      .catch((err: unknown) => {
        const message = messageOf(err, "could not load the run");
        pushLog(`load the detection run failed: ${message}`);
        if (!cancelled) setLoaded({ runId, run: null, error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, selection.id, tick]);

  const done = run?.state === "succeeded";
  // User-initiated: a failure is a toast (and the log), never a silent rejection.
  const startReview = (runId: string) => void review.next(runId, null);
  useToolShortcuts([
    {
      shortcut: "Tab",
      action: "next-pending",
      onTrigger: () => startReview(selection.id),
      disabled: !done,
    },
  ]);

  if (current?.error)
    return (
      <InspectorPane label="Detection run">
        <InspectorSection key="error" title="Detection run">
          <Alert tone="danger">Could not load this run ({current.error}). Reopen it to try again.</Alert>
        </InspectorSection>
      </InspectorPane>
    );
  if (!run)
    return (
      <InspectorPane label="Detection run">
        <InspectorSection key="loading" title="Detection run">
          <Progress label="Loading the run" />
        </InspectorSection>
      </InspectorPane>
    );
  return (
    <InspectorPane
      label="Detection run"
      header={
        <div data-testid="run-inspector" className="flex w-full items-center gap-2">
          <span className="truncate text-sm font-medium">{run.model_name ?? run.provider ?? "Run"}</span>
          {run.scope === "region" && (
            <Pill size="sm" tone="info">
              Region
            </Pill>
          )}
          <span className="flex-1" />
          <Pill size="sm" tone={done ? "ok" : run.state === "failed" ? "danger" : "neutral"} live={running}>
            {stateLabel(run.state ?? "queued")}
          </Pill>
        </div>
      }
    >
      <InspectorSection
        key="progress"
        title={done ? `${run.detection_count} detections` : run.state === "failed" ? "Failed" : "Scanning"}
      >
        {running && <Progress value={job?.progress} running label="Detecting" />}
        {run.scope === "region" && (
          <p className="mt-1 text-xs text-muted">A region run never changes the survey's counts.</p>
        )}
      </InspectorSection>
      {done && (
        <InspectorSection key="review" title="Review">
          <div className="flex flex-col gap-2">
            <Button size="sm" variant="primary" onClick={() => startReview(run.id)}>
              Start review <KeyChord chord="Tab" />
            </Button>
            <AcceptAbove
              projectId={projectId}
              runId={run.id}
              onDone={() => useDetectStore.getState().refresh()}
            />
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </InspectorSection>
      )}
    </InspectorPane>
  );
}
