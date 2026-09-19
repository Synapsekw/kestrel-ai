import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { Box, Image as ImageRow, ReviewState } from "@contract/client";
import {
  fitView,
  oneToOneView,
  zoomAround,
  type Point,
  type Rect,
  type Size,
  type ViewTransform,
} from "@/editor/geometry";

export interface Draft extends Rect {
  classId: string;
}

export const INITIAL_VIEW: ViewTransform = { scale: 1, x: 0, y: 0 };

export interface EditorState {
  imageId: string | null;
  image: ImageRow | null;
  boxes: Record<string, Box>;
  order: string[];
  selectedId: string | null;
  hoveredId: string | null;
  activeClassId: string | null;
  view: ViewTransform;
  viewport: Size;
  fitted: boolean;
  spaceHeld: boolean;
  draft: Draft | null;
  pending: number;
  error: string | null;
  notice: string | null;
  showRejected: boolean;
  /** Unreviewed proposals below this confidence are hidden (0 = show all). Kept across images. */
  minConfidence: number;

  loadImage: (image: ImageRow, boxes: Box[]) => void;
  setImage: (image: ImageRow) => void;
  setBoxes: (boxes: Box[]) => void;
  upsertBox: (box: Box) => void;
  removeBox: (id: string) => void;
  patchStates: (ids: string[], state: ReviewState) => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setActiveClass: (id: string | null) => void;
  setViewport: (size: Size) => void;
  setView: (view: ViewTransform) => void;
  fit: () => void;
  oneToOne: () => void;
  zoomAt: (displayPoint: Point, factor: number) => void;
  setSpaceHeld: (held: boolean) => void;
  setDraft: (draft: Draft | null) => void;
  beginRequest: () => void;
  endRequest: () => void;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
  toggleShowRejected: () => void;
  setMinConfidence: (value: number) => void;
  reset: () => void;
}

function sortedIds(boxes: Record<string, Box>): string[] {
  return Object.values(boxes)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((b) => b.id);
}

function keyed(boxes: Box[]): Record<string, Box> {
  return Object.fromEntries(boxes.map((b) => [b.id, b]));
}

/** An accepted or edited box is ground truth: ground truth and `marked_empty` can never coexist. */
export function hasGroundTruth(boxes: Record<string, Box>): boolean {
  return Object.values(boxes).some((b) => b.review_state === "accepted" || b.review_state === "edited");
}

function isGroundTruth(box: Box): boolean {
  return box.review_state === "accepted" || box.review_state === "edited";
}

/** The store's own copy of the "ground truth clears the mark" invariant (E4 fix round 1, I1). */
function clearMarkIfNeeded(image: ImageRow | null): Partial<EditorState> {
  return image && image.marked_empty ? { image: { ...image, marked_empty: false } } : {};
}

const EMPTY = {
  imageId: null,
  image: null,
  boxes: {},
  order: [],
  selectedId: null,
  hoveredId: null,
  view: INITIAL_VIEW,
  fitted: false,
  spaceHeld: false,
  draft: null,
  pending: 0,
  error: null,
  notice: null,
} satisfies Partial<EditorState>;

export const useEditorStore = create<EditorState>((set, get) => ({
  ...EMPTY,
  activeClassId: null,
  viewport: { width: 0, height: 0 },
  showRejected: false,
  minConfidence: 0,

  loadImage: (image, boxes) =>
    set((s) => {
      const map = keyed(boxes);
      const canFit = s.viewport.width > 0 && s.viewport.height > 0;
      return {
        ...EMPTY,
        imageId: image.id,
        image,
        boxes: map,
        order: sortedIds(map),
        view: canFit ? fitView(image, s.viewport) : INITIAL_VIEW,
        fitted: canFit,
      };
    }),
  // A response for an image the editor has since navigated away from must not land here.
  setImage: (image) => set((s) => (s.imageId === image.id ? { image } : s)),
  setBoxes: (boxes) =>
    set((s) => {
      const map = keyed(boxes);
      return {
        boxes: map,
        order: sortedIds(map),
        selectedId: s.selectedId && map[s.selectedId] ? s.selectedId : null,
        ...(hasGroundTruth(map) ? clearMarkIfNeeded(s.image) : {}),
      };
    }),
  upsertBox: (box) =>
    set((s) => {
      // A response that arrives after the editor moved to another image must not land here.
      if (s.imageId !== null && box.image_id !== s.imageId) return s;
      const boxes = { ...s.boxes, [box.id]: box };
      return {
        boxes,
        order: sortedIds(boxes),
        ...(isGroundTruth(box) ? clearMarkIfNeeded(s.image) : {}),
      };
    }),
  removeBox: (id) =>
    set((s) => {
      const boxes = { ...s.boxes };
      delete boxes[id];
      return {
        boxes,
        order: s.order.filter((x) => x !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
        hoveredId: s.hoveredId === id ? null : s.hoveredId,
      };
    }),
  patchStates: (ids, state) =>
    set((s) => {
      // `unreview` (undo) clears the decision time; every other state records one.
      const reviewedAt = state === "unreviewed" ? null : new Date().toISOString();
      const boxes = { ...s.boxes };
      let touchedGroundTruth = false;
      for (const id of ids)
        if (boxes[id]) {
          boxes[id] = { ...boxes[id], review_state: state, reviewed_at: reviewedAt };
          if (isGroundTruth(boxes[id])) touchedGroundTruth = true;
        }
      return { boxes, ...(touchedGroundTruth ? clearMarkIfNeeded(s.image) : {}) };
    }),
  select: (id) => set((s) => (id === null || s.boxes[id] ? { selectedId: id } : s)),
  hover: (id) => set({ hoveredId: id }),
  setActiveClass: (id) => set({ activeClassId: id }),
  setViewport: (size) =>
    set((s) => {
      if (size.width === s.viewport.width && size.height === s.viewport.height) return s;
      if (s.image && !s.fitted && size.width > 0 && size.height > 0) {
        return { viewport: size, view: fitView(s.image, size), fitted: true };
      }
      return { viewport: size };
    }),
  setView: (view) => set({ view }),
  fit: () => {
    const { image, viewport } = get();
    if (image && viewport.width > 0) set({ view: fitView(image, viewport), fitted: true });
  },
  oneToOne: () => {
    const { image, viewport, view } = get();
    if (image) set({ view: oneToOneView(viewport, view) });
  },
  zoomAt: (displayPoint, factor) => set((s) => ({ view: zoomAround(s.view, displayPoint, factor) })),
  setSpaceHeld: (held) => set({ spaceHeld: held }),
  setDraft: (draft) => set({ draft }),
  beginRequest: () => set((s) => ({ pending: s.pending + 1 })),
  endRequest: () => set((s) => ({ pending: Math.max(0, s.pending - 1) })),
  setError: (message) => set({ error: message }),
  setNotice: (message) => set({ notice: message }),
  toggleShowRejected: () => set((s) => ({ showRejected: !s.showRejected })),
  setMinConfidence: (value) => set({ minConfidence: Math.min(1, Math.max(0, value)) }),
  reset: () => set({ ...EMPTY }),
}));

export type EditorStore = UseBoundStore<StoreApi<EditorState>>;

type Visibility = Pick<EditorState, "boxes" | "order" | "showRejected"> & { minConfidence?: number };

/** Boxes drawn and listed: rejected ones only on request, weak proposals only above the floor. */
export function visibleBoxes(s: Visibility): Box[] {
  const floor = s.minConfidence ?? 0;
  return s.order
    .map((id) => s.boxes[id])
    .filter((b) => b && (s.showRejected || b.review_state !== "rejected"))
    .filter((b) => b.review_state !== "unreviewed" || floor === 0 || (b.confidence ?? 1) >= floor);
}

export function visibleProposalIds(s: Visibility): string[] {
  return visibleBoxes(s)
    .filter((b) => b.review_state === "unreviewed")
    .map((b) => b.id);
}

export function selectedBox(s: Pick<EditorState, "boxes" | "selectedId">): Box | null {
  return s.selectedId ? (s.boxes[s.selectedId] ?? null) : null;
}

/** Resolves once no API call is in flight (auto-save before navigation). */
export function waitForIdle(store: EditorStore = useEditorStore, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve) => {
    if (store.getState().pending === 0) return resolve();
    const timer = setTimeout(() => {
      unsubscribe();
      resolve();
    }, timeoutMs);
    const unsubscribe = store.subscribe((s) => {
      if (s.pending === 0) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}
