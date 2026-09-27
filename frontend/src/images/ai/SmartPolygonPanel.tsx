import { useEffect, type ReactNode } from "react";
import { Button, GlassPanel, Pill, Progress } from "@/ui";
import { SMART_TOOL, useWs } from "./bridge";
import { SAM_OUTSIDE_HINT } from "./sam/hints";
import { useSamStore, useSmartPolygon } from "./sam/useSmartPolygon";
import { samHandle, sameHandle, setSamHandle, useSamHandle } from "./samHandle";

/**
 * The workspace's one S session (drift.md Task 5/10). `useSmartPolygon` subscribes to the view and
 * the viewport (R-FA8), so it lives in this leaf rather than in `useAiWorkspace`, whose host (FW's
 * workspace) would otherwise re-render on every pan frame. It publishes the handle only when
 * something a reader sees changed.
 */
function SmartPolygonSession({ projectId }: { projectId: string }) {
  const smart = useSmartPolygon(projectId);
  useEffect(() => {
    const prev = samHandle();
    if (!prev || !sameHandle(prev, smart)) setSamHandle(smart);
  });
  useEffect(() => () => setSamHandle(null), []);
  return null;
}

/**
 * Under the palette while S is active (spec §10, §16): status, CPU chip, empty mask, and what to do
 * when the weights are not usable. FW mounts it for the whole workspace; it hosts the S session.
 */
export function SmartPolygonPanel() {
  const projectId = useWs((s) => s.projectId);
  return (
    <>
      {projectId ? <SmartPolygonSession projectId={projectId} /> : null}
      <SmartPolygonStatus />
    </>
  );
}

function SmartPolygonStatus() {
  const active = useWs((s) => s.tool === SMART_TOOL);
  const s = useSamStore((x) => x.state);
  const handle = useSamHandle();
  if (!active || !handle) return null;
  const { assist } = handle;
  // The session's reason after a 409 (or the list's state it parked on) wins over the list's.
  const parked =
    handle.availability === "absent"
      ? "absent"
      : s.status === "unavailable"
        ? (s.reason ?? "unavailable")
        : null;
  const size = assist.model ? `≈${Math.round(assist.model.size_mb)} MB` : "";
  const acquiring = assist.job !== null && (assist.job.state === "queued" || assist.job.state === "running");
  const tryAgain = (
    <div className="flex gap-2">
      <Button size="sm" variant="secondary" onClick={handle.retry}>
        Try again
      </Button>
    </div>
  );
  let body: ReactNode;
  if (parked === "absent") {
    body = (
      <>
        <p>Smart polygon is not available in this build</p>
        <p className="text-muted">The other tools work as usual.</p>
      </>
    );
  } else if (parked === "missing" || parked === "invalid") {
    body = (
      <>
        <p>
          {parked === "missing"
            ? size
              ? `Get smart polygon model (${size})`
              : "Get smart polygon model"
            : "The smart polygon model failed its check. Get it again."}
        </p>
        {(s.reasonText ?? assist.model?.reason) ? (
          <p className="text-muted">{s.reasonText ?? assist.model?.reason}</p>
        ) : null}
        {acquiring ? (
          <Progress
            value={assist.job?.progress ?? undefined}
            running
            label="Downloading the smart polygon model"
            thin
          />
        ) : handle.availability === "ready" ? (
          // A prepare 409 parked the session while the list still reads `ready`: an acquire would
          // not change the list, so nothing would un-park it. Ask the server again instead.
          tryAgain
        ) : (
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={assist.getModel}>
              Get model
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void assist.importFile()}>
              Import file…
            </Button>
          </div>
        )}
      </>
    );
  } else if (parked !== null) {
    // `unavailable`: SAM failed to load. The server retries the load on every prepare (I-BS).
    body = (
      <>
        <p>{s.reasonText ?? assist.model?.reason ?? "The smart polygon model could not be loaded."}</p>
        <p className="text-muted">The other tools work as usual.</p>
        {tryAgain}
      </>
    );
  } else if (s.status === "preparing" || handle.availability === "loading") {
    body = <p>Preparing this view…</p>;
  } else if (s.status === "error") {
    body = (
      <>
        <p className="text-danger">{s.error}</p>
        {tryAgain}
      </>
    );
  } else if (s.outside) {
    body = <p>{SAM_OUTSIDE_HINT}</p>;
  } else if (s.empty) {
    body = <p>Nothing found here, try another point</p>;
  } else {
    body = (
      <p>
        {s.polygon ? "Enter creates the polygon · Esc clears" : "Click the defect · Shift+click to exclude"}
      </p>
    );
  }
  return (
    <GlassPanel
      variant="float"
      radius="control"
      role="status"
      data-testid="smart-polygon-panel"
      className="pointer-events-auto flex w-64 flex-col gap-2 px-3 py-2 text-sm"
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">Smart polygon</span>
        {s.device === "cpu" ? (
          <Pill tone="warn" size="sm" title="The GPU is busy (training?); this runs on the processor">
            CPU
          </Pill>
        ) : null}
      </div>
      {body}
    </GlassPanel>
  );
}
