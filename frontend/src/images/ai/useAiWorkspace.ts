import { useEffect, useMemo, useRef } from "react";
import { useApi } from "@/api/client";
import { toast, useSeverityScale } from "@/ui";
import { useAiStore, visibilityNow } from "./aiStore";
import {
  activateTool,
  SMART_TOOL,
  useCommandContext,
  useImagesWorkspace,
  useToolApi,
  wsGet,
  type KeyHandlers,
  type WsState,
} from "./bridge";
import { BULK_CONFIRM_ABOVE, cmdReviewSuggestions, setFindingSeverity } from "./review";
import { nextFlaggedImage, stepWalk, targetOf, visibleSuggestions, walkOrder } from "./suggestions";
import { readThreshold, stepThreshold, writeThreshold } from "./threshold";

export interface ImageIndexLike {
  ids: readonly string[];
  flags: readonly number[];
}
export interface AiWorkspaceOptions {
  projectId: string;
  index: ImageIndexLike | null;
  onOpenImage: (imageId: string) => void;
}

/** The Tab walk's position: the focused suggestion, else a single selected shape. */
const walkPosition = (s: WsState) =>
  s.focusedSuggestionId ?? (s.selectedIds.length === 1 ? s.selectedIds[0] : null);

/**
 * G5 (drift.md): FC's `whenMatches` quiets rows only behind FC's own confirm and picker. Behind FA's
 * BulkConfirm or model menu, FA's keys are swallowed (handled, not `false`, so no later layer acts
 * on the canvas behind the overlay either).
 */
const behindOverlay = (): boolean => {
  const { confirm, menuOpen } = useAiStore.getState();
  return confirm !== null || menuOpen;
};

export function useAiWorkspace(opts: AiWorkspaceOptions): { keyHandlers: KeyHandlers } {
  const { projectId } = opts;
  const api = useApi();
  const ctx = useCommandContext(projectId);
  const toolApi = useToolApi(ctx);
  const scaleSize = useSeverityScale().length;
  const latest = useRef(opts);
  useEffect(() => {
    latest.current = opts;
  });

  // R-FA16: the threshold is FC's state; FA restores it per project and saves every change.
  useEffect(() => {
    wsGet().setThreshold(readThreshold(projectId));
    return useImagesWorkspace.subscribe((s, prev) => {
      if (s.threshold !== prev.threshold) writeThreshold(projectId, s.threshold);
    });
  }, [projectId]);

  const keyHandlers = useMemo<KeyHandlers>(() => {
    const ai = () => useAiStore.getState();
    const visibleNow = () => {
      const s = wsGet();
      return { s, visible: visibleSuggestions(s.boxes, s.order, visibilityNow()) };
    };

    const review = (action: "accept" | "reject", all: boolean) => {
      const { s, visible } = visibleNow();
      const ids = all
        ? visible.map((b) => b.id)
        : [targetOf(visible, s.focusedSuggestionId)?.id].filter((x): x is string => !!x);
      if (ids.length === 0) return;
      if (all && ids.length > BULK_CONFIRM_ABOVE) {
        ai().askConfirm({ action, ids });
        return;
      }
      void cmdReviewSuggestions(ctx, ids, action);
    };

    const walk = (dir: 1 | -1) => {
      const { s, visible } = visibleNow();
      const step = stepWalk(
        walkOrder(visible, s.order, (id) => s.findingOf[id] !== undefined),
        walkPosition(s),
        dir,
      );
      if (step.kind === "box") {
        if (visible.some((b) => b.id === step.id)) {
          s.select([]);
          s.focusSuggestion(step.id); // the inspector's suggestion card (FW)
        } else {
          s.focusSuggestion(null);
          s.select([step.id]); // a finding: the inspector opens it
        }
        return;
      }
      const index = latest.current.index;
      const next = index ? nextFlaggedImage(index, s.imageId, dir) : null;
      if (next) latest.current.onOpenImage(next);
      else
        toast("info", dir === 1 ? "No more images with suggestions" : "No earlier images with suggestions");
    };

    const threshold = (dir: 1 | -1) => wsGet().setThreshold(stepThreshold(wsGet().threshold, dir));

    return {
      accept: () => {
        if (!behindOverlay()) review("accept", false);
      },
      reject: () => {
        if (!behindOverlay()) review("reject", false);
      },
      "accept-all": () => {
        if (!behindOverlay()) review("accept", true);
      },
      "reject-all": () => {
        if (!behindOverlay()) review("reject", true);
      },
      "next-pending": () => {
        if (!behindOverlay()) walk(1);
      },
      "previous-pending": () => {
        if (!behindOverlay()) walk(-1);
      },
      "threshold-down": () => {
        if (!behindOverlay()) threshold(-1);
      },
      "threshold-up": () => {
        if (!behindOverlay()) threshold(1);
      },
      // D: opens the menu; inside it D runs the model (spec §11.2). Quiet behind the bulk confirm.
      "ai-detect": () => {
        if (ai().confirm) return;
        if (ai().menuOpen) ai().requestRun();
        else ai().openMenu();
      },
      "smart-polygon": () => {
        if (!behindOverlay()) activateTool(SMART_TOOL, toolApi);
      },
      severity: (chord) => {
        if (behindOverlay()) return;
        const level = Number(chord);
        if (!(level >= 1 && level <= scaleSize)) return;
        const s = wsGet();
        const id = s.selectedIds.length === 1 ? s.selectedIds[0] : null;
        const findingId = id ? s.findingOf[id] : undefined;
        if (findingId) void setFindingSeverity(api, projectId, findingId, level);
      },
      // Esc: FA's only while a detection runs (R-FA5); otherwise the next layer (FC) cancels.
      cancel: () => {
        if (!ai().discardDetect()) return false;
        toast("info", "Detection result discarded");
      },
    };
  }, [api, projectId, ctx, toolApi, scaleSize]);

  return { keyHandlers };
}
