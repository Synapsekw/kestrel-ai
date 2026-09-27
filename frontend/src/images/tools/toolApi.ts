import { useMemo } from "react";
import type { BoxWriteResult } from "@/api/shapes";
import { cmdCreateMeasurement, cmdCreateShape, type CommandContext } from "@/images/canvas/commands";
import type { Point } from "@/images/canvas/geometry";
import { toast } from "@/ui/toastStore";
import type { ToolApi } from "./types";

/** Canvas-container px of the last pointer move; the T picker opens there (spec §9.2). */
export const lastPointer: { current: Point | null } = { current: null };

type CreatedListener = (result: BoxWriteResult) => void;
const createdListeners = new Set<CreatedListener>();

/**
 * Hears every shape a tool creates, whichever ToolApi made it: the canvas's pointer routing and
 * the key handlers (Enter closing a polygon) each build their own (I2). Returns the unsubscribe.
 */
export function onShapeCreated(listener: CreatedListener): () => void {
  createdListeners.add(listener);
  return () => void createdListeners.delete(listener);
}

export function makeToolApi(
  ctx: CommandContext,
  notify: ToolApi["notify"] = (text, tone = "info") => void toast(tone, text),
): ToolApi {
  const openPicker: ToolApi["openPicker"] = (purpose) => {
    const s = ctx.store.getState();
    const at = lastPointer.current ?? { x: s.viewport.width / 2, y: s.viewport.height / 2 };
    s.openPicker(at, purpose);
  };
  return {
    store: ctx.store,
    notify,
    openPicker,
    createShape: async (body) => {
      const s = ctx.store.getState();
      if (!s.imageId) return undefined;
      if (!s.activeTypeId) {
        openPicker("active");
        notify("Pick a type first (T).");
        return undefined;
      }
      const created = await cmdCreateShape(ctx, s.imageId, { ...body, class_id: s.activeTypeId });
      if (created) for (const l of [...createdListeners]) l(created);
      return created;
    },
    createMeasurement: async (a, b) => {
      const imageId = ctx.store.getState().imageId;
      if (imageId) await cmdCreateMeasurement(ctx, imageId, a, b);
    },
  };
}

export function useToolApi(ctx: CommandContext): ToolApi {
  return useMemo(() => makeToolApi(ctx), [ctx]);
}
