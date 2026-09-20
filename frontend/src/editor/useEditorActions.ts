import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useApi } from "@/api/client";
import { useEditorStore, visibleProposalIds } from "@/store/editor";
import {
  cmdCreateBox,
  cmdDelete,
  cmdDuplicate,
  cmdRedo,
  cmdReview,
  cmdSetClass,
  cmdToggleEmpty,
  cmdUndo,
  cmdUpdateRect,
  enqueue,
  type CommandContext,
  type ReviewDecision,
} from "./commands";
import { clampOriented, orientedRectOf, roundOriented, type OrientedRect, type Rect } from "./geometry";
import type { History } from "./history";

export interface EditorActions {
  drawBox: (rect: Rect, classId: string) => Promise<void>;
  commitRect: (id: string, before: OrientedRect, after: OrientedRect) => Promise<void>;
  deleteBox: (id: string) => Promise<void>;
  deleteSelected: () => Promise<void>;
  duplicateSelected: () => Promise<void>;
  rotateSelected: (delta: number) => Promise<void>;
  setClass: (id: string, classId: string) => Promise<void>;
  review: (ids: string[], action: ReviewDecision) => Promise<void>;
  acceptAll: () => Promise<void>;
  rejectAll: () => Promise<void>;
  toggleEmpty: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/**
 * Stable command bindings plus undo/redo availability, which re-renders on every history change.
 * Every action goes through the image's queue (`enqueue`), so commands run one at a time in the
 * order the user issued them and the history stack matches that order.
 */
export function useEditorActions(
  projectId: string,
  history: History,
): { actions: EditorActions; canUndo: boolean; canRedo: boolean } {
  const api = useApi();
  const subscribe = useCallback((listener: () => void) => history.subscribe(listener), [history]);
  const canUndo = useSyncExternalStore(subscribe, () => history.canUndo());
  const canRedo = useSyncExternalStore(subscribe, () => history.canRedo());
  const ctx = useMemo<CommandContext>(
    () => ({ api, projectId, store: useEditorStore, history }),
    [api, projectId, history],
  );

  const actions = useMemo<EditorActions>(() => {
    const state = () => useEditorStore.getState();
    const queued = (fn: () => Promise<unknown>) => enqueue(ctx, fn).then(() => undefined);
    return {
      drawBox: (rect, classId) =>
        queued(async () => {
          const imageId = state().imageId;
          if (imageId) await cmdCreateBox(ctx, imageId, { class_id: classId, ...rect });
        }),
      commitRect: (id, before, after) => queued(() => cmdUpdateRect(ctx, id, before, after)),
      deleteBox: (id) => queued(() => cmdDelete(ctx, id)),
      deleteSelected: () =>
        queued(async () => {
          const id = state().selectedId;
          if (id) await cmdDelete(ctx, id);
        }),
      duplicateSelected: () =>
        queued(async () => {
          const id = state().selectedId;
          if (id) await cmdDuplicate(ctx, id);
        }),
      rotateSelected: (delta) =>
        queued(async () => {
          const st = state();
          const id = st.selectedId;
          const box = id ? st.boxes[id] : undefined;
          const image = st.image;
          if (!id || !box || !image) return;
          const before = orientedRectOf(box);
          // Clamped like every other write path. Nudging a legitimately overhanging box back to
          // angle 0 puts it under the upright "fully inside" rule, which the server rejects — the
          // box would be stuck at 1 degree with no way home. The clamp pulls it in instead.
          const after = clampOriented({ ...before, angle: before.angle + delta }, image);
          await cmdUpdateRect(ctx, id, before, roundOriented(after));
        }),
      setClass: (id, classId) => queued(() => cmdSetClass(ctx, id, classId)),
      review: (ids, action) => queued(() => cmdReview(ctx, ids, action)),
      acceptAll: () => queued(() => cmdReview(ctx, visibleProposalIds(state()), "accept")),
      rejectAll: () => queued(() => cmdReview(ctx, visibleProposalIds(state()), "reject")),
      toggleEmpty: () => queued(() => cmdToggleEmpty(ctx)),
      undo: () => queued(() => cmdUndo(ctx)),
      redo: () => queued(() => cmdRedo(ctx)),
    };
  }, [ctx]);

  return { actions, canUndo, canRedo };
}
