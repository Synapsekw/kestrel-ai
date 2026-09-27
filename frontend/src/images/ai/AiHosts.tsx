import { useEffect } from "react";
import { BulkConfirm } from "./BulkConfirm";
import { useWs } from "./bridge";
import { useSmartPolygon } from "./sam/useSmartPolygon";
import { samHandle, sameHandle, setSamHandle } from "./samHandle";

/**
 * The workspace's one S session (drift.md Task 5/10). `useSmartPolygon` subscribes to the view and
 * the viewport (R-FA8), so it lives in this leaf rather than in `useAiWorkspace`, whose host (FW's
 * workspace) would otherwise re-render on every pan frame. It publishes the handle only when
 * something a reader sees changed; the S tool and `SmartPolygonPanel` read it.
 */
function Session({ projectId }: { projectId: string }) {
  const smart = useSmartPolygon(projectId);
  useEffect(() => {
    const prev = samHandle();
    if (!prev || !sameHandle(prev, smart)) setSamHandle(smart);
  });
  useEffect(() => () => setSamHandle(null), []);
  return null;
}

/** Hosts the S session for FC's current project; renders nothing. */
export function SmartPolygonSession() {
  const projectId = useWs((s) => s.projectId);
  return projectId ? <Session projectId={projectId} /> : null;
}

/**
 * FA's always-on hosts: the S session and the Shift+A / Shift+X bulk confirm. FW mounts this once
 * for the whole Images workspace, **unconditionally** (not behind the S tool or the hint bar), so
 * the session exists before S is pressed and the confirm can open while the hint bar is hidden.
 */
export function AiHosts({ projectId }: { projectId: string }) {
  return (
    <>
      <SmartPolygonSession />
      <BulkConfirm projectId={projectId} />
    </>
  );
}
