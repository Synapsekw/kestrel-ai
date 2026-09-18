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
  cmdUndo,
  cmdUpdateRect,
  type CommandContext,
  type ReviewDecision,
} from "./commands";
import type { Rect } from "./geometry";
import type { History } from "./history";

export interface EditorActions {
  drawBox: (rect: Rect, classId: string) => Promise<void>;
  commitRect: (id: string, before: Rect, after: Rect) => Promise<void>;
  deleteBox: (id: string) => Promise<void>;
  deleteSelected: () => Promise<void>;
  duplicateSelected: () => Promise<void>;
  setClass: (id: string, classId: string) => Promise<void>;
  review: (ids: string[], action: ReviewDecision) => Promise<void>;
  acceptAll: () => Promise<void>;
  rejectAll: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/** Stable command bindings plus undo/redo availability, which re-renders on every history change. */
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
    return {
      drawBox: async (rect, classId) => {
        const imageId = state().imageId;
        if (imageId) await cmdCreateBox(ctx, imageId, { class_id: classId, ...rect });
      },
      commitRect: (id, before, after) => cmdUpdateRect(ctx, id, before, after),
      deleteBox: (id) => cmdDelete(ctx, id),
      deleteSelected: async () => {
        const id = state().selectedId;
        if (id) await cmdDelete(ctx, id);
      },
      duplicateSelected: async () => {
        const id = state().selectedId;
        if (id) await cmdDuplicate(ctx, id);
      },
      setClass: (id, classId) => cmdSetClass(ctx, id, classId),
      review: (ids, action) => cmdReview(ctx, ids, action),
      acceptAll: () => cmdReview(ctx, visibleProposalIds(state()), "accept"),
      rejectAll: () => cmdReview(ctx, visibleProposalIds(state()), "reject"),
      undo: () => cmdUndo(ctx),
      redo: () => cmdRedo(ctx),
    };
  }, [ctx]);

  return { actions, canUndo, canRedo };
}
