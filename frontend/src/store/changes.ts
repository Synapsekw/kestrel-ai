import { create } from "zustand";
import type { AppEvent } from "@contract/client";

interface ChangesState {
  /** Bumped whenever the image list may have changed (import batches, box counts). */
  imagesRevision: number;
  /** Per image id: bumped whenever a job wrote proposals or reviews on it. */
  boxesRevision: Record<string, number>;
  applyEvent: (ev: AppEvent) => void;
  bumpImages: () => void;
}

export const useChangesStore = create<ChangesState>((set) => ({
  imagesRevision: 0,
  boxesRevision: {},
  bumpImages: () => set((s) => ({ imagesRevision: s.imagesRevision + 1 })),
  applyEvent: (ev) =>
    set((s) => {
      if (ev.type === "images.changed") return { imagesRevision: s.imagesRevision + 1 };
      if (ev.type === "boxes.changed") {
        const ids = (ev.payload as { image_ids?: unknown }).image_ids;
        if (!Array.isArray(ids)) return s;
        const boxesRevision = { ...s.boxesRevision };
        for (const id of ids) if (typeof id === "string") boxesRevision[id] = (boxesRevision[id] ?? 0) + 1;
        return { boxesRevision, imagesRevision: s.imagesRevision + 1 };
      }
      return s;
    }),
}));
