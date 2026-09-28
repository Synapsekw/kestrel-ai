import { useCallback, useRef, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import {
  REVIEW_CHUNK,
  findingIdsToDelete,
  nextUnreviewedSite,
  reviewDetections,
  type MapDetection,
  type MapDetectionReview,
} from "@/api/mapDetect";
import { pushLog } from "@/app/diagnostics";
import { useWorkspace } from "@/mapws/w4host";
import { useChangesStore } from "@/store/changes";
import { toast } from "@/ui";
import { chunk, detectionSelection } from "./detectModel";
import { useDetectStore } from "./detectStore";
import { waitForFindingIds } from "./findingEvents";

export type ReviewAction = MapDetectionReview["action"];
export type KindOf = (typeId: string) => "defect" | "object" | undefined;

export interface PendingConfirm {
  runId: string;
  ids: string[];
  action: ReviewAction;
  classId?: string;
  findingIds: string[];
  detection: MapDetection | null;
}

function fail(action: string, err: unknown) {
  const message = messageOf(err, `could not ${action}`);
  pushLog(`${action} failed: ${message}`);
  toast("danger", message);
}

/** After a saved decision: the move on failed, not the decision (so the copy must not blame the review). */
function moveFailed(err: unknown) {
  const message = messageOf(err, "could not open the next detection");
  pushLog(`move to the next detection failed: ${message}`);
  toast(
    "danger",
    `The decision was saved, but moving to the next detection failed (${message}). Press Tab to try again.`,
  );
}

/** Shift+X over detections with findings: F refuses the bulk write; the confirm is per detection. */
export const BULK_HAS_FINDINGS = "Some of these detections have findings; reject them one by one to confirm.";

const extentOf = (c: number[][]): [number, number, number, number] => {
  const xs = c.map((p) => p[0]);
  const ys = c.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/** Review in the map workspace (spec §9.3): the existing endpoints, F's 409 confirm, accept → finding. */
export function useReview(projectId: string) {
  const api = useApi();
  const select = useWorkspace((s) => s.select);
  const viewApi = useWorkspace((s) => s.viewApi);
  // A ref, not state: a second `A` in the same tick must see the first decision in flight.
  const busy = useRef(false);
  const [busyState, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);

  const advance = useCallback(
    async (runId: string, afterId: string | null) => {
      let next = await nextUnreviewedSite(api, projectId, runId, afterId);
      if (!next.detection && next.remaining > 0 && afterId)
        next = await nextUnreviewedSite(api, projectId, runId, null);
      const d = next.detection;
      if (!d) {
        toast("ok", "Every detection in this run is reviewed.");
        select({ kind: "run", id: runId });
        return;
      }
      useDetectStore.getState().remember(runId, [d]);
      const sel = detectionSelection(runId, d.id);
      useDetectStore.getState().pushHistory(sel);
      if (d.corners_site) viewApi?.fit(extentOf(d.corners_site));
      select(sel);
    },
    [api, projectId, select, viewApi],
  );

  const run = useCallback(async (label: string, op: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setBusy(true);
    try {
      await op();
    } catch (err) {
      fail(label, err);
    } finally {
      busy.current = false;
      setBusy(false);
    }
  }, []);

  /** Accepting (or reclassing into) a defect: wait for the event that names the new finding. */
  const after = useCallback(
    async (
      runId: string,
      d: MapDetection | null,
      action: ReviewAction,
      kind: "defect" | "object" | undefined,
      rev: number,
    ) => {
      useDetectStore.getState().refresh();
      if (d && (action === "accept" || action === "reclass") && kind === "defect") {
        const ids = await waitForFindingIds(rev);
        if (ids?.[0]) {
          select({ kind: "finding", id: ids[0] });
          return;
        }
        toast("info", "The finding was created; open it from the Findings layer.");
      }
      if (d) await advance(runId, d.id).catch(moveFailed);
    },
    [select, advance],
  );

  const decide = useCallback(
    (runId: string, d: MapDetection, action: ReviewAction, classId?: string, kindOf?: KindOf) =>
      run("review the detection", async () => {
        const body = classId
          ? { detection_ids: [d.id], action, class_id: classId }
          : { detection_ids: [d.id], action };
        const rev = useChangesStore.getState().findingsRevision;
        try {
          await reviewDetections(api, projectId, runId, body);
        } catch (err) {
          const findingIds = findingIdsToDelete(err);
          if (findingIds === null) throw err;
          setConfirm({ runId, ids: [d.id], action, classId, findingIds, detection: d });
          return;
        }
        await after(runId, d, action, kindOf?.(classId ?? d.class_id), rev);
      }),
    [api, projectId, run, after],
  );

  const decideMany = useCallback(
    (action: "accept" | "reject") =>
      run("review the detections in view", async () => {
        const store = useDetectStore.getState;
        try {
          for (const [runId, ids] of Object.entries(store().inView)) {
            for (const part of chunk(ids, REVIEW_CHUNK)) {
              if (!part.length) continue;
              try {
                await reviewDetections(api, projectId, runId, { detection_ids: part, action });
              } catch (err) {
                if (findingIdsToDelete(err) !== null) throw new Error(BULK_HAS_FINDINGS);
                throw err;
              }
              // Saved: out of the view set, so a quick second Shift+A / Shift+X never resends them.
              const sent = new Set(part);
              store().setInView(
                runId,
                (store().inView[runId] ?? []).filter((id) => !sent.has(id)),
              );
            }
          }
        } finally {
          // Even after a partial failure: the chunks that were saved must stop showing as pending.
          store().refresh();
        }
      }),
    [api, projectId, run],
  );

  const confirmDelete = useCallback(async () => {
    const c = confirm;
    if (!c) return;
    setConfirm(null);
    await run("review the detection", async () => {
      const body = c.classId
        ? { detection_ids: c.ids, action: c.action, class_id: c.classId }
        : { detection_ids: c.ids, action: c.action };
      await reviewDetections(api, projectId, c.runId, body, true);
      useDetectStore.getState().refresh();
      if (c.detection) await advance(c.runId, c.detection.id).catch(moveFailed);
    });
  }, [api, projectId, confirm, run, advance]);

  const cancelConfirm = useCallback(() => setConfirm(null), []);

  /** Tab / Start review: the handled path (toast + log), and refused while a decision is in flight. */
  const next = useCallback(
    (runId: string, afterId: string | null) => run("open the next detection", () => advance(runId, afterId)),
    [run, advance],
  );

  return {
    busy: busyState,
    confirm,
    decide,
    decideMany,
    confirmDelete,
    cancelConfirm,
    next,
  };
}
