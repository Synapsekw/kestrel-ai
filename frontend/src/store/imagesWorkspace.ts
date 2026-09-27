import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { Box, ClassDef, ReviewState } from "@contract/client";
import type { FindingDetail } from "@/api/findings";
import type { ImageDetail, ImageMeasurement } from "@/api/shapes";
import {
  clampScale,
  fitView,
  oneToOneView,
  toImage,
  zoomAround,
  ZOOM_STEP,
  type Point,
  type Rect,
  type Size,
  type ViewTransform,
} from "@/images/canvas/geometry";
import { History } from "@/images/canvas/history";
import { animateView } from "@/images/canvas/viewTween";
import { dur, isReducedMotion } from "@/ui/motion";

export type ToolId = "select" | "pan" | "box" | "rbox" | "polygon" | "point" | "length" | (string & {});

export type Draft =
  | { kind: "rect"; anchor: Point; start: Point; rect: Rect | null }
  | { kind: "rbox"; stage: "edge" | "width"; a: Point; b: Point; c: Point | null }
  | { kind: "polygon"; points: Point[]; cursor: Point | null; pressed: boolean; lastScreen: Point | null }
  | { kind: "length"; a: Point; b: Point | null }
  | { kind: "custom"; tool: string; data: unknown };

export type ConfirmState =
  | { kind: "delete"; ids: string[]; findings: FindingDetail[] }
  | { kind: "retype"; ids: string[]; typeId: string }
  | null;

export const INITIAL_VIEW: ViewTransform = { scale: 1, x: 0, y: 0 };
export const THRESHOLD_STEP = 0.05;

export interface ImagesWorkspaceState {
  projectId: string | null;
  imageId: string | null;
  image: ImageDetail | null;
  types: ClassDef[];
  boxes: Record<string, Box>;
  order: string[];
  measurements: Record<string, ImageMeasurement>;
  selectedIds: string[];
  selectedMeasurementId: string | null;
  hoveredId: string | null;
  focusedSuggestionId: string | null;
  tool: ToolId;
  activeTypeId: string | null;
  draft: Draft | null;
  view: ViewTransform;
  viewport: Size;
  fitted: boolean;
  keepZoom: boolean;
  interacting: boolean;
  spaceHeld: boolean;
  shiftHeld: boolean;
  altHeld: boolean;
  showAnnotations: boolean;
  showSuggestions: boolean;
  threshold: number;
  history: History;
  pending: number;
  failure: { message: string; retry: (() => void) | null } | null;
  picker: { at: Point; purpose: "retype" | "active" } | null;
  confirm: ConfirmState;
  /** Box id → finding id; `Box` carries no link (C0 ruling 1, FC-R16). */
  findingOf: Record<string, string>;

  setProject: (projectId: string) => void;
  loadImage: (image: ImageDetail, boxes: Box[], measurements: ImageMeasurement[]) => void;
  setImage: (image: ImageDetail) => void;
  setTypes: (types: readonly ClassDef[]) => void;
  setBoxes: (boxes: Box[]) => void;
  upsertBox: (box: Box) => void;
  removeBox: (id: string) => void;
  patchStates: (ids: string[], state: ReviewState) => void;
  upsertMeasurement: (m: ImageMeasurement) => void;
  removeMeasurement: (id: string) => void;
  select: (ids: string[], mode?: "replace" | "toggle") => void;
  selectMeasurement: (id: string | null) => void;
  hover: (id: string | null) => void;
  focusSuggestion: (id: string | null) => void;
  setTool: (tool: ToolId) => void;
  setActiveType: (id: string | null) => void;
  setDraft: (draft: Draft | null) => void;
  setViewport: (size: Size) => void;
  setView: (view: ViewTransform) => void;
  fit: () => void;
  oneToOne: () => void;
  zoomAt: (display: Point, factor: number) => void;
  zoomBy: (factor: number) => void;
  centreOn: (point: Point, opts?: { radiusPx?: number; animate?: boolean }) => void;
  panIntoView: (rect: Rect, opts?: { animate?: boolean }) => void;
  setKeepZoom: (on: boolean) => void;
  setInteracting: (on: boolean) => void;
  setHeld: (keys: Partial<{ space: boolean; shift: boolean; alt: boolean }>) => void;
  toggleAnnotations: () => void;
  toggleSuggestions: () => void;
  setThreshold: (value: number) => void;
  beginRequest: () => void;
  endRequest: () => void;
  fail: (message: string, retry?: () => void) => void;
  clearFailure: () => void;
  openPicker: (at: Point, purpose: "retype" | "active") => void;
  closePicker: () => void;
  setConfirm: (c: ConfirmState) => void;
  linkFindings: (links: Record<string, string>) => void;
  unlinkFinding: (boxId: string) => void;
  reset: () => void;
}

function sortedIds(boxes: Record<string, Box>): string[] {
  return Object.values(boxes)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((b) => b.id);
}

const keyed = <T extends { id: string }>(rows: readonly T[]): Record<string, T> =>
  Object.fromEntries(rows.map((r) => [r.id, r]));

/** Everything that belongs to one image; `pending` and `failure` survive navigation on purpose. */
const PER_IMAGE = {
  selectedIds: [] as string[],
  selectedMeasurementId: null,
  hoveredId: null,
  focusedSuggestionId: null,
  draft: null,
  picker: null,
  confirm: null,
  findingOf: {} as Record<string, string>,
} satisfies Partial<ImagesWorkspaceState>;

let cancelTween: (() => void) | null = null;

export const useImagesWorkspace = create<ImagesWorkspaceState>((set, get) => {
  /** Every view change goes through here so a running tween never fights a new one. */
  const moveTo = (target: ViewTransform, animate = false) => {
    cancelTween?.();
    cancelTween = null;
    if (!animate || isReducedMotion()) {
      set({ view: target });
      return;
    }
    cancelTween = animateView(get().view, target, dur.slow, (v) => set({ view: v }));
  };

  return {
    projectId: null,
    imageId: null,
    image: null,
    types: [],
    boxes: {},
    order: [],
    measurements: {},
    ...PER_IMAGE,
    tool: "select",
    activeTypeId: null,
    view: INITIAL_VIEW,
    viewport: { width: 0, height: 0 },
    fitted: false,
    keepZoom: false,
    interacting: false,
    spaceHeld: false,
    shiftHeld: false,
    altHeld: false,
    showAnnotations: true,
    showSuggestions: true,
    threshold: 0,
    history: new History(),
    pending: 0,
    failure: null,

    setProject: (projectId) => set((s) => (s.projectId === projectId ? s : { projectId })),
    loadImage: (image, boxes, measurements) =>
      set((s) => {
        const map = keyed(boxes);
        const canFit = s.viewport.width > 0 && s.viewport.height > 0;
        const keep =
          s.keepZoom && s.fitted && s.image !== null && s.image.width === image.width && s.image.height === image.height;
        cancelTween?.();
        return {
          ...PER_IMAGE,
          imageId: image.id,
          image,
          boxes: map,
          order: sortedIds(map),
          measurements: keyed(measurements),
          history: new History(),
          view: keep ? s.view : canFit ? fitView(image, s.viewport) : INITIAL_VIEW,
          fitted: keep || canFit,
        };
      }),
    // A response for an image the workspace has since left must not land here.
    setImage: (image) => set((s) => (s.imageId === image.id ? { image } : s)),
    setTypes: (types) => set({ types: [...types] }),
    setBoxes: (boxes) =>
      set((s) => {
        const map = keyed(boxes.filter((b) => b.image_id === s.imageId));
        return {
          boxes: map,
          order: sortedIds(map),
          selectedIds: s.selectedIds.filter((id) => map[id]),
          focusedSuggestionId: s.focusedSuggestionId && map[s.focusedSuggestionId] ? s.focusedSuggestionId : null,
        };
      }),
    upsertBox: (box) =>
      set((s) => {
        if (s.imageId !== null && box.image_id !== s.imageId) return s;
        const boxes = { ...s.boxes, [box.id]: box };
        return { boxes, order: s.boxes[box.id] ? s.order : sortedIds(boxes) };
      }),
    removeBox: (id) =>
      set((s) => {
        if (!s.boxes[id]) return s;
        const boxes = { ...s.boxes };
        delete boxes[id];
        return {
          boxes,
          order: s.order.filter((x) => x !== id),
          selectedIds: s.selectedIds.filter((x) => x !== id),
          hoveredId: s.hoveredId === id ? null : s.hoveredId,
          focusedSuggestionId: s.focusedSuggestionId === id ? null : s.focusedSuggestionId,
        };
      }),
    patchStates: (ids, state) =>
      set((s) => {
        const reviewedAt = state === "unreviewed" ? null : new Date().toISOString();
        const boxes = { ...s.boxes };
        for (const id of ids) if (boxes[id]) boxes[id] = { ...boxes[id], review_state: state, reviewed_at: reviewedAt };
        return { boxes };
      }),
    upsertMeasurement: (m) =>
      set((s) => (s.imageId !== null && m.image_id !== s.imageId ? s : { measurements: { ...s.measurements, [m.id]: m } })),
    removeMeasurement: (id) =>
      set((s) => {
        const measurements = { ...s.measurements };
        delete measurements[id];
        return { measurements, selectedMeasurementId: s.selectedMeasurementId === id ? null : s.selectedMeasurementId };
      }),
    select: (ids, mode = "replace") =>
      set((s) => {
        const known = ids.filter((id) => s.boxes[id]);
        let next: string[];
        if (mode === "toggle") {
          next = [...s.selectedIds];
          for (const id of known) next = next.includes(id) ? next.filter((x) => x !== id) : [...next, id];
        } else next = known;
        return { selectedIds: next, selectedMeasurementId: next.length ? null : s.selectedMeasurementId };
      }),
    selectMeasurement: (id) =>
      set((s) => (id !== null && !s.measurements[id] ? s : { selectedMeasurementId: id, selectedIds: id ? [] : s.selectedIds })),
    hover: (id) => set((s) => (s.hoveredId === id ? s : { hoveredId: id })),
    focusSuggestion: (id) => set({ focusedSuggestionId: id }),
    setTool: (tool) => set((s) => (s.tool === tool ? s : { tool, draft: null })),
    setActiveType: (id) => set({ activeTypeId: id }),
    setDraft: (draft) => set({ draft }),
    setViewport: (size) =>
      set((s) => {
        if (size.width === s.viewport.width && size.height === s.viewport.height) return s;
        if (s.image && !s.fitted && size.width > 0 && size.height > 0) {
          return { viewport: size, view: fitView(s.image, size), fitted: true };
        }
        return { viewport: size };
      }),
    setView: (view) => {
      cancelTween?.();
      cancelTween = null;
      set({ view });
    },
    fit: () => {
      const { image, viewport } = get();
      if (image && viewport.width > 0) {
        moveTo(fitView(image, viewport));
        set({ fitted: true });
      }
    },
    oneToOne: () => {
      const { image, viewport, view } = get();
      if (image) moveTo(oneToOneView(viewport, view));
    },
    zoomAt: (display, factor) => moveTo(zoomAround(get().view, display, factor)),
    zoomBy: (factor) => {
      const { viewport, view } = get();
      moveTo(zoomAround(view, { x: viewport.width / 2, y: viewport.height / 2 }, factor));
    },
    centreOn: (point, opts = {}) => {
      const { viewport, view } = get();
      if (viewport.width <= 0 || viewport.height <= 0) return;
      const scale =
        opts.radiusPx === undefined
          ? view.scale
          : clampScale(Math.min(viewport.width, viewport.height) / 3 / (2 * Math.max(1, opts.radiusPx)));
      moveTo({ scale, x: viewport.width / 2 - point.x * scale, y: viewport.height / 2 - point.y * scale }, opts.animate);
    },
    panIntoView: (rect, opts = {}) => {
      const s = get();
      if (s.viewport.width <= 0) return;
      const visible = viewportImageRect(s);
      const inside =
        rect.x >= visible.x &&
        rect.y >= visible.y &&
        rect.x + rect.w <= visible.x + visible.w &&
        rect.y + rect.h <= visible.y + visible.h;
      if (inside) return;
      const fits = Math.min((s.viewport.width * 0.8) / Math.max(1, rect.w), (s.viewport.height * 0.8) / Math.max(1, rect.h));
      const scale = clampScale(Math.min(s.view.scale, fits));
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      moveTo({ scale, x: s.viewport.width / 2 - cx * scale, y: s.viewport.height / 2 - cy * scale }, opts.animate);
    },
    setKeepZoom: (on) => set({ keepZoom: on }),
    setInteracting: (on) => set((s) => (s.interacting === on ? s : { interacting: on })),
    setHeld: (keys) =>
      set((s) => ({
        spaceHeld: keys.space ?? s.spaceHeld,
        shiftHeld: keys.shift ?? s.shiftHeld,
        altHeld: keys.alt ?? s.altHeld,
      })),
    toggleAnnotations: () => set((s) => ({ showAnnotations: !s.showAnnotations })),
    toggleSuggestions: () => set((s) => ({ showSuggestions: !s.showSuggestions })),
    setThreshold: (value) => set({ threshold: Math.round(Math.min(1, Math.max(0, value)) * 100) / 100 }),
    beginRequest: () => set((s) => ({ pending: s.pending + 1 })),
    endRequest: () => set((s) => ({ pending: Math.max(0, s.pending - 1) })),
    fail: (message, retry) => set({ failure: { message, retry: retry ?? null } }),
    clearFailure: () => set({ failure: null }),
    openPicker: (at, purpose) => set({ picker: { at, purpose } }),
    closePicker: () => set({ picker: null }),
    setConfirm: (confirm) => set({ confirm }),
    linkFindings: (links) => set((s) => ({ findingOf: { ...s.findingOf, ...links } })),
    unlinkFinding: (boxId) =>
      set((s) => {
        if (!(boxId in s.findingOf)) return s;
        const findingOf = { ...s.findingOf };
        delete findingOf[boxId];
        return { findingOf };
      }),
    reset: () => {
      cancelTween?.();
      cancelTween = null;
      set({
        ...PER_IMAGE,
        imageId: null,
        image: null,
        boxes: {},
        order: [],
        measurements: {},
        view: INITIAL_VIEW,
        fitted: false,
        interacting: false,
        spaceHeld: false,
        shiftHeld: false,
        altHeld: false,
        history: new History(),
        pending: 0,
        failure: null,
      });
    },
  };
});

export type ImagesWorkspaceStore = UseBoundStore<StoreApi<ImagesWorkspaceState>>;
type S = ImagesWorkspaceState;

/** Accepted and edited shapes are ground truth; person shapes are created accepted. */
export function isAccepted(b: Box): boolean {
  return b.review_state === "accepted" || b.review_state === "edited";
}

/** Layer 2. Rejected and unreviewed shapes never appear here. */
export function acceptedShapes(s: Pick<S, "boxes" | "order" | "showAnnotations">): Box[] {
  if (!s.showAnnotations) return [];
  return s.order.map((id) => s.boxes[id]).filter((b): b is Box => !!b && isAccepted(b));
}

/** Layer 3's targets: unreviewed at or above the threshold, most confident first (spec §11.4). */
export function pendingSuggestions(s: Pick<S, "boxes" | "order" | "threshold" | "showSuggestions">): Box[] {
  if (!s.showSuggestions) return [];
  return s.order
    .map((id) => s.boxes[id])
    .filter((b): b is Box => !!b && b.review_state === "unreviewed" && (b.confidence ?? 1) >= s.threshold)
    .sort((a, b) => (b.confidence ?? 1) - (a.confidence ?? 1));
}

export function selectedShapes(s: Pick<S, "boxes" | "selectedIds">): Box[] {
  return s.selectedIds.map((id) => s.boxes[id]).filter((b): b is Box => !!b);
}

export function singleSelected(s: Pick<S, "boxes" | "selectedIds">): Box | null {
  return s.selectedIds.length === 1 ? (s.boxes[s.selectedIds[0]] ?? null) : null;
}

export function typeOf(s: Pick<S, "types">, typeId: string): ClassDef | undefined {
  return s.types.find((t) => t.id === typeId);
}

export function saveState(s: Pick<S, "pending" | "failure">): "saved" | "saving" | "failed" {
  if (s.failure) return "failed";
  return s.pending > 0 ? "saving" : "saved";
}

/** The part of the image on screen, in image px, clipped to the image (FA's SAM crop, §10). */
export function viewportImageRect(s: Pick<S, "view" | "viewport" | "image">): Rect {
  if (!s.image) return { x: 0, y: 0, w: 0, h: 0 };
  const a = toImage({ x: 0, y: 0 }, s.view);
  const b = toImage({ x: s.viewport.width, y: s.viewport.height }, s.view);
  const x = Math.max(0, a.x);
  const y = Math.max(0, a.y);
  return {
    x,
    y,
    w: Math.max(0, Math.min(s.image.width, b.x) - x),
    h: Math.max(0, Math.min(s.image.height, b.y) - y),
  };
}

export function isDrawing(s: Pick<S, "draft">): boolean {
  return s.draft !== null;
}

export { ZOOM_STEP };

/** Resolves once no API call is in flight (auto-save before navigation). */
export function waitForIdle(store: ImagesWorkspaceStore = useImagesWorkspace, timeoutMs = 10_000): Promise<void> {
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
