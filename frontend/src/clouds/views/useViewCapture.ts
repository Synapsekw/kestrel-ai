import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { CloudViewOut, CloudViewRender } from "@contract/client";
import { useApi } from "@/api/client";
import { listCloudMeasurements } from "@/api/cloudMeasurements";
import { listCloudViews, putCloudMeasurementView3d, putFindingView3d } from "@/api/cloudViews";
import { messageOf } from "@/api/errors";
import { fetchFinding, listFindings } from "@/api/findings";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { toast } from "@/ui";
import type { CloudViewerHandle } from "../CloudViewer";
import type { CaptureReason, ViewSubject } from "../workspace/seams";
import { captureEngineFrom } from "./captureEngine";
import { findingAnchor, missingSubjects } from "./missing";
import { CaptureQueue, type JobOutcome, type SubjectGeometry } from "./queue";
import { subjectKey, useViewStore, type QueueReason } from "./viewStore";

export type RenderNow = Pick<CloudViewRender, "colour_mode" | "point_budget" | "point_size" | "clip_box">;

export interface UseViewCaptureOptions {
  projectId: string;
  cloudId: string;
  viewer: RefObject<CloudViewerHandle | null>;
  /** The on-screen settings and clip box; edl and complete come from the capture. */
  render: () => RenderNow;
}

export interface ViewCapture {
  requestViewCapture: (subject: ViewSubject, reason: CaptureReason) => void;
  captureMissing: () => void;
  cancelMissing: () => void;
}

/** A burst of `findings.changed` / `pointclouds.changed` re-reads the views once. */
export const VIEWS_SETTLE_MS = 400;
export const NOT_SAVED = "The report view was not saved. Use Capture in the inspector to try again.";
export const QUEUE_STOPPED =
  "The 3D view could not take report views. Reload the view, then use Capture missing views.";
/** Bulk-run findings cap: the 500-pin cap (spec §9.2). */
const FINDINGS_CAP = 500;

type BulkRun = { cancelled: "no" | "user" | "leave" };

/**
 * Keeps the store's current entry for any key a PUT committed for (`onView`) after `startSeq` was
 * read, instead of the `listCloudViews` snapshot for it. Without this, a read in flight while a
 * capture's PUT completes can land afterwards and describe the pre-PUT server state, silently
 * reverting a just-saved (or just-refreshed) view to absent/stale (reviewer finding, fix round 1).
 */
function keepFresherViews(
  current: Record<string, CloudViewOut> | null,
  items: CloudViewOut[],
  lastPutSeq: ReadonlyMap<string, number>,
  startSeq: number,
): Record<string, CloudViewOut> {
  const next: Record<string, CloudViewOut> = {};
  for (const v of items) next[`${v.subject_kind}:${v.subject_id}`] = v;
  if (current)
    for (const [key, seq] of lastPutSeq) if (seq > startSeq && key in current) next[key] = current[key];
  return next;
}

/**
 * The workspace's report-view client (spec §11.3): the one-at-a-time capture queue, the views of
 * this cloud in `useViewStore`, and "Capture missing views". Unmounting is leaving the workspace:
 * queued captures are dropped silently.
 */
export function useViewCapture({ projectId, cloudId, viewer, render }: UseViewCaptureOptions): ViewCapture {
  const api = useApi();
  const renderRef = useRef(render);
  useEffect(() => {
    renderRef.current = render;
    useViewStore.getState().setReady(viewer.current !== null);
  });

  // Every capture that is not the bulk run's own (automatic requests and the card's buttons).
  const requestRef = useRef<((s: ViewSubject, r: QueueReason) => void) | null>(null);
  // Per-key PUT sequence numbers, for `keepFresherViews`: bumped once per successful capture,
  // reset whenever this effect (re-)sets up for a project/cloud.
  const putSeq = useRef(0);
  const lastPutSeq = useRef(new Map<string, number>());
  useEffect(() => {
    const store = useViewStore.getState;
    store().reset(projectId, cloudId);
    store().setReady(viewer.current !== null);
    putSeq.current = 0;
    lastPutSeq.current = new Map();
    // A bulk item's geometry from the lists read when the run started, for its own job only.
    const cache = new Map<string, SubjectGeometry>();
    // Keys requested outside the bulk run since it started: their geometry may have moved since the
    // lists were read, so the run never hands them list geometry (final review).
    const touched = new Set<string>();
    const queue = new CaptureQueue({
      engine: () => (viewer.current ? captureEngineFrom(viewer.current) : null),
      resolve: async (s) => {
        const hit = cache.get(subjectKey(s));
        if (hit) {
          cache.delete(subjectKey(s));
          return hit;
        }
        if (s.kind === "finding") {
          const anchor = findingAnchor(await fetchFinding(api, projectId, s.id), cloudId);
          if (!anchor) throw new Error("the finding is not anchored on this cloud");
          return { kind: "finding", anchor };
        }
        const m = (await listCloudMeasurements(api, projectId, cloudId)).find((x) => x.id === s.id);
        if (!m) throw new Error("the measurement no longer exists");
        return { kind: "cloud_measurement", measurement: m };
      },
      storedView: (s) => store().views?.[subjectKey(s)] ?? null,
      render: () => renderRef.current(),
      upload: (s, image, meta, signal) =>
        s.kind === "finding"
          ? putFindingView3d(api, projectId, s.id, image, meta, signal)
          : putCloudMeasurementView3d(api, projectId, cloudId, s.id, image, meta, signal),
      onView: (v) => {
        const key = `${v.subject_kind}:${v.subject_id}`;
        putSeq.current += 1;
        lastPutSeq.current.set(key, putSeq.current);
        store().putView(v);
      },
      onBusy: (key, busy) => store().setBusy(key, busy),
      onFail: (s, err, stopped) => {
        pushLog(`report view ${subjectKey(s)} failed: ${messageOf(err, "unknown error")}`);
        toast("info", stopped ? QUEUE_STOPPED : NOT_SAVED);
      },
      log: pushLog,
    });
    const request = (s: ViewSubject, r: QueueReason) => {
      const key = subjectKey(s);
      touched.add(key);
      cache.delete(key); // a waiting bulk job for it now resolves fresh geometry
      void queue.enqueue(s, r);
    };
    requestRef.current = request;

    let bulk: BulkRun | null = null;
    const cancelMissing = (why: "user" | "leave") => {
      if (bulk) bulk.cancelled = why;
      bulk = null;
      store().setBulk(null);
    };
    const captureMissing = async () => {
      if (bulk) return;
      const run: BulkRun = { cancelled: "no" };
      bulk = run;
      store().setBulk({ done: 0, total: 0 });
      let done = 0;
      let failed = 0;
      let total = 0;
      const startSeq = putSeq.current;
      touched.clear();
      try {
        const [findings, measurements, views] = await Promise.all([
          listFindings(api, projectId, { anchor_kind: ["cloud"], data_id: cloudId, limit: FINDINGS_CAP }),
          listCloudMeasurements(api, projectId, cloudId),
          listCloudViews(api, projectId, cloudId),
        ]);
        if (run.cancelled !== "no") return;
        const kept = keepFresherViews(store().views, views.items, lastPutSeq.current, startSeq);
        useViewStore.setState({ views: kept });
        const todo = missingSubjects(cloudId, findings.items, measurements, Object.values(kept));
        total = todo.length;
        if (total === 0) {
          toast("ok", "Every finding and measurement here has a current report view");
          return;
        }
        store().setBulk({ done, total });
        for (const item of todo) {
          if (run.cancelled !== "no") break;
          const key = subjectKey(item.subject);
          const stored = store().views?.[key];
          if ((lastPutSeq.current.get(key) ?? 0) > startSeq && stored && !stored.stale) {
            // Saved during this run (a move's own capture): re-capturing from the list geometry
            // would put the pin back in its old place and mark it current.
            done += 1;
            if (run.cancelled === "no") store().setBulk({ done, total });
            continue;
          }
          if (!touched.has(key)) cache.set(key, item.geometry);
          let outcome: JobOutcome;
          try {
            outcome = await queue.enqueue(item.subject, "missing", { quiet: true });
          } finally {
            cache.delete(key); // also when a stop dropped it unresolved
          }
          if (outcome === "stopped") break; // the queue already reported it (or we left)
          if (outcome === "failed") failed += 1;
          done += 1;
          if (run.cancelled === "no") store().setBulk({ done, total });
        }
        // `run.cancelled` is set by `cancelMissing`, called from outside this function while the
        // loop above awaits; cast past TS's stale narrowing of it to "no" from the check above.
        const cancelledAt = run.cancelled as BulkRun["cancelled"];
        if (cancelledAt === "user") toast("info", `Stopped after ${done} of ${total} report views`);
        else if (cancelledAt === "no" && done === total)
          toast(
            failed ? "info" : "ok",
            failed ? `${failed} of ${total} report views were not saved` : `Saved ${total} report views`,
          );
      } catch (err) {
        if (run.cancelled === "no")
          toast("info", `Could not list the missing views: ${messageOf(err, "unknown error")}`);
      } finally {
        if (bulk === run) {
          bulk = null;
          store().setBulk(null);
        }
      }
    };

    store().setActions({
      enqueue: request,
      captureMissing: () => void captureMissing(),
      cancelMissing: () => cancelMissing("user"),
    });
    return () => {
      cancelMissing("leave");
      queue.dispose();
      requestRef.current = null;
      cache.clear();
      useViewStore.getState().reset(null, null);
    };
  }, [api, projectId, cloudId, viewer]);

  const findingsRevision = useChangesStore((s) => s.findingsRevision);
  const pointcloudsRevision = useChangesStore((s) => s.pointcloudsRevision); // C-W1
  const lastCloud = useRef<string | null>(null);
  useEffect(() => {
    const key = `${projectId}/${cloudId}`;
    // The very first load for a cloud runs right away; a burst of revision bumps on the same
    // cloud settles for VIEWS_SETTLE_MS first (so 3 quick events cause one re-read, not three).
    const settle = lastCloud.current === key;
    lastCloud.current = key;
    let cancelled = false;
    const read = () => {
      const startSeq = putSeq.current;
      listCloudViews(api, projectId, cloudId).then(
        (list) => {
          if (cancelled) return;
          useViewStore.setState((s) => ({
            views: keepFresherViews(s.views, list.items, lastPutSeq.current, startSeq),
          }));
        },
        (err) => {
          if (cancelled) return;
          pushLog(`listCloudViews failed: ${messageOf(err, "unknown error")}`);
          if (useViewStore.getState().views === null) useViewStore.getState().setViews([]);
        },
      );
    };
    const timer = settle ? setTimeout(read, VIEWS_SETTLE_MS) : null;
    if (!settle) read();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [api, projectId, cloudId, findingsRevision, pointcloudsRevision]);

  const requestViewCapture = useCallback((subject: ViewSubject, reason: CaptureReason) => {
    requestRef.current?.(subject, reason);
  }, []);
  const captureMissing = useCallback(() => useViewStore.getState().actions?.captureMissing(), []);
  const cancelMissing = useCallback(() => useViewStore.getState().actions?.cancelMissing(), []);
  return { requestViewCapture, captureMissing, cancelMissing };
}
