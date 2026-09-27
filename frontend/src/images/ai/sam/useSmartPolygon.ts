import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { useApi } from "@/api/client";
import { codeOf, messageOf } from "@/api/errors";
import { prepareSegment, segment, type SegmentPoint, type SegmentResult } from "../api";
import { SMART_TOOL, useCommandContext, useToolApi, useWs, wsGet } from "../bridge";
import { cropKey, inside, viewportCrop } from "./crop";
import { LatestOnly } from "./latest";
import { INITIAL_SAM, samReducer, type SamAction, type SamState } from "./session";
import { useAssistModel, type Availability } from "./useAssistModel";

export interface SmartPolygon {
  state: SamState;
  availability: Availability;
  assist: ReturnType<typeof useAssistModel>;
  active: boolean;
  click: (p: { x: number; y: number }, positive: boolean) => void;
  /** FC's onRemoveVertex: true when a point was removed; false lets the key fall through. */
  removeLast: () => boolean;
  /** FC's onCancel: true when there were points to clear; false lets Esc reach FC (deselect). */
  cancel: () => boolean;
  /** FC's onCommit: true when Enter is S's (an outline, or points still segmenting). */
  commit: () => boolean;
  /**
   * Start over after `unavailable` or an error: the server retries loading SAM on every prepare
   * (I-BS), so S never disables itself for good. Re-reads the assist list and prepares again.
   */
  retry: () => void;
}

/** One S session for the workspace; the tool definition, the panel and the preview read it. */
export const useSamStore = create<{
  state: SamState;
  handle: SmartPolygon | null;
  dispatch: (a: SamAction) => void;
}>((set) => ({
  state: INITIAL_SAM,
  handle: null,
  dispatch: (a) => set((s) => ({ state: samReducer(s.state, a) })),
}));
const dispatch = (a: SamAction) => useSamStore.getState().dispatch(a);
const sam = () => useSamStore.getState().state;

export const VIEW_SETTLE_MS = 300;

/** FC's key rows `commit`/`remove-vertex` fire only while a draft exists (FC Task 8). */
function markDrawing(): void {
  const s = wsGet();
  if (!s.draft) s.setDraft({ kind: "custom", tool: SMART_TOOL, data: null });
}
function clearDrawing(): void {
  const s = wsGet();
  if (s.draft?.kind === "custom" && s.draft.tool === SMART_TOOL) s.setDraft(null);
}
const missingState = (e: unknown) =>
  String((e as { details?: { state?: string } }).details?.state ?? "missing");

/** Availabilities that are not worth a prepare: no file, a bad file, or no assist routes at all. */
const NO_PREPARE: ReadonlySet<Availability> = new Set(["missing", "invalid", "absent"]);

export function useSmartPolygon(projectId: string): SmartPolygon {
  const api = useApi();
  const toolApi = useToolApi(useCommandContext(projectId));
  const assist = useAssistModel();
  const active = useWs((s) => s.tool === SMART_TOOL);
  const imageId = useWs((s) => s.imageId);
  const view = useWs((s) => s.view);
  const viewport = useWs((s) => s.viewport);
  const state = useSamStore((s) => s.state);
  const reload = assist.reload;
  const availability = assist.availability;
  const [retryNonce, setRetryNonce] = useState(0);

  const sender = useMemo(
    () =>
      new LatestOnly<{ imageId: string; points: SegmentPoint[]; seq: number }, SegmentResult>(
        (v) => {
          dispatch({ type: "segmenting" });
          return segment(api, projectId, v.imageId, sam().crop!, v.points);
        },
        (r, v) => {
          if (wsGet().imageId !== v.imageId) return;
          dispatch({ type: "segmented", seq: v.seq, polygon: r.polygon, device: r.device });
        },
        (e) => {
          if (codeOf(e) === "assist_model_missing") {
            dispatch({ type: "unavailable", state: missingState(e) });
            clearDrawing();
            reload();
          } else dispatch({ type: "failed", message: messageOf(e, "smart polygon failed") });
        },
      ),
    [api, projectId, reload],
  );

  // A new image or leaving the tool ends the session (FC clears its draft on both).
  useEffect(() => {
    sender.reset();
    dispatch({ type: "reset" });
  }, [imageId, active, sender]);

  // The model became ready (an acquire or import finished): a session parked on `unavailable`
  // starts over so the prepare effect below runs.
  useEffect(() => {
    if (availability === "ready" && sam().status === "unavailable") dispatch({ type: "reset" });
  }, [availability]);

  // Prepare the visible crop on select, and again after the view settles while no point is placed (R-FA8).
  const prepareSeq = useRef(0);
  useEffect(() => {
    if (!active || !imageId) return;
    if (availability === "loading") return;
    if (NO_PREPARE.has(availability)) {
      dispatch({ type: "unavailable", state: availability });
      return;
    }
    // `ready`, or `unavailable` from the list: the server retries the load, so try. A 409 parks the
    // session on `unavailable` until retry(), a new image, re-selecting S, or the model turning ready.
    if (sam().status === "unavailable") return;
    if (sam().points.length > 0) return;
    const image = wsGet().image;
    const crop = image ? viewportCrop(view, viewport, image) : null;
    if (!crop) return;
    const key = cropKey(crop);
    if (sam().key === key) return;
    const seq = ++prepareSeq.current;
    const timer = setTimeout(
      () => {
        if (seq !== prepareSeq.current) return;
        dispatch({ type: "prepare", key });
        prepareSegment(api, projectId, imageId, crop)
          .then((r) => {
            if (wsGet().imageId === imageId)
              dispatch({ type: "prepared", key, crop: r.crop, device: r.device });
          })
          .catch((e: unknown) => {
            if (wsGet().imageId !== imageId || sam().key !== key) return;
            if (codeOf(e) === "assist_model_missing") {
              dispatch({ type: "unavailable", state: missingState(e) });
              reload();
            } else dispatch({ type: "failed", message: messageOf(e, "could not prepare the smart polygon") });
          });
      },
      sam().key === null ? 0 : VIEW_SETTLE_MS,
    );
    return () => clearTimeout(timer);
  }, [active, imageId, view, viewport, availability, reload, api, projectId, retryNonce]);

  const click = useCallback(
    (p: { x: number; y: number }, positive: boolean) => {
      const s = sam();
      const id = wsGet().imageId;
      if (s.status === "unavailable" || !s.crop || !id) return; // R-FA7: nothing is drawn until ready
      if (!inside(s.crop, p)) {
        dispatch({ type: "outside" }); // R-FA8: the panel shows SAM_OUTSIDE_HINT; no 422 round trip
        return;
      }
      dispatch({
        type: "point",
        point: { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, positive },
      });
      markDrawing();
      const next = sam();
      sender.submit({ imageId: id, points: next.points, seq: next.seq });
    },
    [sender],
  );

  const removeLast = useCallback(() => {
    if (sam().points.length === 0) return false;
    dispatch({ type: "removeLast" });
    const next = sam();
    const id = wsGet().imageId;
    if (next.points.length === 0) {
      sender.reset();
      clearDrawing();
    } else if (id) sender.submit({ imageId: id, points: next.points, seq: next.seq });
    return true;
  }, [sender]);

  const cancel = useCallback(() => {
    if (sam().points.length === 0) return false;
    sender.reset();
    dispatch({ type: "cancel" });
    clearDrawing();
    return true;
  }, [sender]);

  const commit = useCallback(() => {
    const s = sam();
    if (!s.polygon) return s.points.length > 0; // Enter while still segmenting: S's, but nothing yet
    // FC's ToolApi adds the active type, or opens the T picker when there is none (R-FA9).
    void toolApi.createShape({ shape: "polygon", points: s.polygon, assist: "sam" }).then((created) => {
      if (!created) return;
      sender.reset();
      dispatch({ type: "cancel" });
      clearDrawing();
    });
    return true;
  }, [toolApi, sender]);

  const retry = useCallback(() => {
    sender.reset();
    dispatch({ type: "reset" }); // clears the crop key and the `unavailable` park
    clearDrawing();
    reload();
    setRetryNonce((n) => n + 1);
  }, [sender, reload]);

  return { state, availability, assist, active, click, removeLast, cancel, commit, retry };
}
