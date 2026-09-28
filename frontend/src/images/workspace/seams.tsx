/* eslint-disable react-refresh/only-export-components --
   seams is a barrel of FC/FB/FA parts plus FW's adapter hooks; it renders nothing itself. */
/**
 * I-FW Ruling 1: the only FW file that names FC, FB or FA code. Every other file in
 * images/workspace imports from here. Reconciled against main @ c1bdc0b (+ H1/H2 on task/i-fw):
 * - FA has no `SamLayer` and no key-layer hook: `useAiWorkspace({ projectId, index, onOpenImage })`
 *   returns `{ keyHandlers }` (no `findingIdOf`, `paletteTools`, `enabled`); `useAiKeyLayer` dropped.
 * - FA adds `AiHosts` (mount once, unconditionally), `AiDetectButton` (ToolPalette children),
 *   `ensureAiRegistered()` (call once); `HintBar` takes no props.
 * - `useSuggestionActions` calls FA's `cmdReviewSuggestions` (images/ai/review.ts, not in FA's
 *   barrel; accept morph, links the finding, toasts) instead of FC's bare `cmdReview`.
 * - `ImageDetail`, `ImageCamera`, `fetchImageDetail` are FC's, in `@/api/shapes`; `@/api/images`
 *   re-exports the two types and adds only `setSubjectDistance`.
 * - `batchScopeOf`'s filter scope is the contract's `ImageFilter` (number/string arrays, boolean
 *   `reviewed`, no sort), built here; the plan's `filtersToIndexQuery` cast would send the index
 *   query's comma strings.
 * - FC's `measureShape(...).basis` reads "from GSD 1.8 mm/px · ±4 mm at 38.4 m" with no source
 *   label; `CameraScale.source` carries the raw `distance_source` (Ruling 9's text is FW's to build).
 * - FC draws a Konva length label (`lengthLabel`) on the L draft and saved lengths, but no HTML
 *   readout or info chip, so `FC_RENDERS` stays all false.
 */
import { useCallback } from "react";
import type { components } from "@contract/client";
import { imageFileUrl, type Box } from "@contract/client";
import { useBackend } from "@/api/client";
import type { ImageDetail } from "@/api/images";
import { cmdReviewSuggestions } from "@/images/ai/review";
import type { BatchScope } from "@/images/ai";
import type { BrowserFilterState } from "@/images/browser";
import { cmdDeleteShapes, useCommandContext } from "@/images/canvas/commands";
import { saveState, singleSelected, useImagesWorkspace } from "@/store/imagesWorkspace";

export { ImageCanvas, LAYER_NAMES, type ImageCanvasHandle } from "@/images/canvas/ImageCanvas";
export { ToolPalette } from "@/images/tools/ToolPalette";
export { ZoomCluster } from "@/images/tools/ZoomCluster";
export { useImageData } from "@/images/canvas/useImageData";
export { useCommandContext, type CommandContext } from "@/images/canvas/commands";
export { useCanvasKeyHandlers } from "@/images/canvas/useCanvasKeys";
/** FC's AABB of an oriented box (clockwise about its centre, degrees) and of a point list; panTo.ts's
 * `shapeBounds` uses these for box/rbox/polygon and keeps only the point pad local. */
export { aabbOf, envelopeOf, orientedRectOf, toPoints } from "@/images/canvas/geometry";
export { statusHintsFor, useHeldKeys, useImagesKeymap, type KeyHandlers } from "@/images/workspace/keymap";
export {
  lengthLabel,
  measureShape,
  scaleFromCamera,
  type CameraScale,
  type MeasuredTiles,
} from "@/images/tools/measure";
export { useImagesWorkspace } from "@/store/imagesWorkspace";
export {
  applyPreset,
  BrowserFilters,
  BrowserGrid,
  BrowserSelectionBar,
  CaptureMap,
  DEFAULT_BROWSER_FILTERS,
  Filmstrip,
  filtersToIndexQuery,
  FLAG_GPS,
  indexNeighbours,
  MiniMap,
  useImageIndex,
  type BrowserFilterState,
  type FootprintInput,
  type ImageIndexState,
} from "@/images/browser";
export {
  AiBar,
  AiDetectButton,
  AiHosts,
  BatchDetectDialog,
  BatchDetectWatch,
  ensureAiRegistered,
  HintBar,
  ModelMenu,
  SamWarmEdge,
  SmartPolygonPanel,
  SuggestionChip,
  SuggestionsLayer,
  useAiWorkspace,
  type BatchScope,
} from "@/images/ai";

type ImageFilter = components["schemas"]["ImageFilter"];

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function useSelection(): {
  selectedId: string | null;
  select: (id: string | null) => void;
  boxes: Readonly<Record<string, Box>>;
  boxesLoaded: boolean;
} {
  const focused = useImagesWorkspace((s) => s.focusedSuggestionId);
  const single = useImagesWorkspace((s) => singleSelected(s)?.id ?? null);
  const boxes = useImagesWorkspace((s) => s.boxes);
  const boxesLoaded = useImagesWorkspace((s) => s.imageId !== null && s.image !== null);
  const select = useCallback(
    (id: string | null) => useImagesWorkspace.getState().select(id ? [id] : [], "replace"),
    [],
  );
  return { selectedId: focused ?? single, select, boxes, boxesLoaded };
}

export function useDetail(): ImageDetail | null {
  return useImagesWorkspace((s) => (s.image && s.image.id === s.imageId ? s.image : null));
}

export function useSaveState(): { state: "saved" | "saving" | "failed"; retry: () => void } {
  const state = useImagesWorkspace(saveState);
  const retry = useCallback(() => {
    const s = useImagesWorkspace.getState();
    if (s.failure?.retry) s.failure.retry();
    else s.clearFailure();
  }, []);
  return { state, retry };
}

export const useActiveTool = (): string => useImagesWorkspace((s) => s.tool);
export const useInteracting = (): boolean => useImagesWorkspace((s) => s.interacting);
export const useScale = (): number => useImagesWorkspace((s) => s.view.scale);

/** The L tool's length being drawn, else the selected saved measurement. */
export function useActiveMeasurement(): Segment | null {
  const d = useImagesWorkspace((s) => (s.draft?.kind === "length" ? s.draft : null));
  const m = useImagesWorkspace((s) =>
    s.selectedMeasurementId ? (s.measurements[s.selectedMeasurementId] ?? null) : null,
  );
  if (d?.b) return { x1: d.a.x, y1: d.a.y, x2: d.b.x, y2: d.b.y };
  return m ? { x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2 } : null;
}

export function useFindingLinks(): {
  findingOf: Readonly<Record<string, string>>;
  linkFindings: (l: Record<string, string>) => void;
} {
  const findingOf = useImagesWorkspace((s) => s.findingOf);
  const linkFindings = useImagesWorkspace((s) => s.linkFindings);
  return { findingOf, linkFindings };
}

export function useShapeActions(projectId: string): { remove: (id: string) => void } {
  const ctx = useCommandContext(projectId);
  return { remove: (id: string) => void cmdDeleteShapes(ctx, [id]) };
}

export function useSuggestionActions(projectId: string): {
  accept: (id: string) => void;
  reject: (id: string) => void;
} {
  const ctx = useCommandContext(projectId);
  return {
    accept: (id: string) => void cmdReviewSuggestions(ctx, [id], "accept"),
    reject: (id: string) => void cmdReviewSuggestions(ctx, [id], "reject"),
  };
}

export function useImageUrl(projectId: string): (imageId: string, maxSide: number | null) => string {
  const { baseUrl, token } = useBackend();
  return useCallback(
    (imageId: string, maxSide: number | null) =>
      imageFileUrl(baseUrl, token, projectId, imageId, maxSide ?? undefined),
    [baseUrl, token, projectId],
  );
}

/** The browser's filters as the contract's `ImageFilter` (the batch-detect scope), defaults omitted. */
function imageFilterOf(f: BrowserFilterState): ImageFilter {
  const q: ImageFilter = {};
  if (f.sourceId) q.source_id = f.sourceId;
  if (f.hasFindings) q.has_findings = true;
  if (f.findingStatus !== "all") q.finding_status = [f.findingStatus];
  if (f.severities.length > 0) q.severity = [...f.severities].sort((a, b) => b - a);
  if (f.typeIds.length > 0) q.type_ids = [...f.typeIds].sort();
  if (f.hasSuggestions) q.has_suggestions = true;
  if (f.reviewed !== "all") q.reviewed = f.reviewed === "yes";
  if (f.unlabeled) q.unlabeled = true;
  const search = f.search.trim();
  if (search) q.search = search;
  return q;
}

/** FA's batch scope: a selection or lasso → ids; a flight filter → the source; else the filters (never 100k ids). */
export function batchScopeOf(
  filters: BrowserFilterState,
  ids: readonly string[] | null,
  total: number,
): { scope: BatchScope; scopeLabel: string; scopeCount: number | null } {
  if (ids && ids.length > 0)
    return { scope: { image_ids: [...ids] }, scopeLabel: `${ids.length} selected`, scopeCount: ids.length };
  if (filters.sourceId)
    return { scope: { source_id: filters.sourceId }, scopeLabel: "This flight", scopeCount: null };
  return { scope: { filter: imageFilterOf(filters) }, scopeLabel: `${total} images`, scopeCount: total };
}

/** Ruling 1: FC's plan lists the info chip and the measure readout as not FC's (confirmed on main). */
export const FC_RENDERS = { infoChip: false, measureReadout: false } as const;
