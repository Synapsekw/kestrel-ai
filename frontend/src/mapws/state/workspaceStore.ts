import { createStore, type StoreApi } from "zustand/vanilla";
import type { PointCloud } from "@/api/clouds";
import type { MapWorkspace } from "../api";
import { GROUP_ORDER, type LayerGroup } from "../layers/layerRegistry";
import type { CompareMode, Coord, Selection, Survey, WorkspaceLayer } from "../types";
import type { SiteExtent } from "../view/siteGrid";
import { SURVEY_DATE_RE, canCompare, flownDates, stepSurvey } from "./surveys";

/** How many maps and surfaces each frame can show (M-C0 `FrameItemCounts`). */
export type FrameItemCounts = MapWorkspace["frame_items"];

export const COMPARE_MODES: readonly CompareMode[] = ["single", "swipe", "side", "blend"];
/** Spec §5.1: P plays through the surveys at 900 ms per step. */
export const PLAY_STEP_MS = 900;
/** Spec §6: the persisted state is at most 64 KB. */
export const STATE_MAX_BYTES = 65536;

export interface LayerUserState {
  visible: boolean;
  /** 0…100. */
  opacity: number;
  /** Kind-specific (render mode, contour interval, DXF layer toggles, knockout white). */
  style?: Record<string, unknown>;
}

export interface ViewInfo {
  center: Coord;
  resolution: number;
  rotation: number;
}

/** Drives the OL View; SiteMap publishes it once the view exists (makeViewApi). */
export interface ViewApi {
  centreOn: (c: Coord, resolution?: number) => void;
  fit: (extent: SiteExtent) => void;
  zoomBy: (delta: number) => void;
  resetNorth: () => void;
  /** Screen pixel of a site coordinate on the (left or single) map, for tool popovers; null before it renders. */
  pixelOf: (c: Coord) => [number, number] | null;
  /** The site coordinate under a pixel of that map (the inverse of pixelOf); null before it renders. */
  coordOf: (px: [number, number]) => Coord | null;
}

/** The right-click menu: where it opened (client px) and the site coordinate under it. */
export interface StageMenuState {
  x: number;
  y: number;
  coord: Coord;
}

/** `PUT /map-workspace {state}` (spec §5.2). */
export interface PersistedState {
  v: 1;
  mode: CompareMode;
  l: string | null;
  r: string | null;
  blend: number;
  swipe: number;
  layers: Record<string, LayerUserState>;
  order: Partial<Record<LayerGroup, string[]>>;
  view: ViewInfo | null;
}

export interface WorkspaceState {
  surveys: Survey[];
  mode: CompareMode;
  l: string | null;
  r: string | null;
  /** Blend 0…100 (0 = left only). */
  blend: number;
  /** Swipe divider position, 2…98 % of the stage width. */
  swipe: number;
  layersCollapsed: boolean;
  /** The collapse state before Side-by-side, restored on leaving it. */
  collapsedBeforeSide: boolean | null;
  layerState: Record<string, LayerUserState>;
  /** Row keys per group, top first (the layers panel order). */
  order: Partial<Record<LayerGroup, string[]>>;
  selection: Selection | null;
  playing: boolean;
  /** The readout shows WGS84 lon/lat instead of E/N. */
  wgs84: boolean;
  pointer: Coord | null;
  viewInfo: ViewInfo | null;
  /** The view to start from (the persisted one); null fits the site. */
  initialView: ViewInfo | null;
  viewApi: ViewApi | null;
  /** listWorkspaceLayers, loaded once per revision by MapWorkspace and shared (useWorkspaceLayers). */
  layers: WorkspaceLayer[];
  layersLoading: boolean;
  /** The project's point clouds (for the 3D jump). */
  clouds: PointCloud[];
  /** `MapWorkspace.frame_items`: maps and surfaces each frame can show; null before the first read. */
  frameItems: FrameItemCounts | null;
  stageMenu: StageMenuState | null;
  setLayers: (layers: WorkspaceLayer[], loading: boolean) => void;
  setClouds: (clouds: PointCloud[]) => void;
  setFrameItems: (items: FrameItemCounts) => void;
  openStageMenu: (menu: StageMenuState) => void;
  closeStageMenu: () => void;

  setSurveys: (surveys: Survey[]) => void;
  setMode: (mode: CompareMode) => void;
  cycleMode: () => void;
  setDates: (l: string | null, r: string | null) => void;
  /** `]` (1) and `[` (−1); false when blocked. */
  stepRight: (dir: 1 | -1) => boolean;
  togglePlay: () => void;
  setPlaying: (on: boolean) => void;
  setBlend: (v: number) => void;
  setSwipe: (v: number) => void;
  toggleLayersCollapsed: () => void;
  setLayerState: (key: string, patch: Partial<LayerUserState>) => void;
  setOrder: (group: LayerGroup, keys: string[]) => void;
  select: (sel: Selection | null) => void;
  toggleWgs84: () => void;
  setPointer: (c: Coord | null) => void;
  setViewInfo: (v: ViewInfo) => void;
  setViewApi: (api: ViewApi | null) => void;
  /** Applies persisted or URL state; dates that are not flown surveys are dropped. */
  hydrate: (p: Partial<PersistedState>) => void;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Valid dates for `mode`: r a flown date (default the newest); in compare modes l < r. */
function fixDates(
  dates: readonly string[],
  mode: CompareMode,
  l: string | null,
  r: string | null,
): { l: string | null; r: string | null } {
  if (dates.length === 0) return { l: null, r: null };
  let nr = r !== null && dates.includes(r) ? r : dates[dates.length - 1];
  let nl = l !== null && dates.includes(l) ? l : null;
  if (nl === null) {
    const before = dates.filter((d) => d < nr);
    nl = before.length ? before[before.length - 1] : null;
  }
  if (mode !== "single" && (nl === null || nl >= nr)) {
    const before = dates.filter((d) => d < nr);
    if (before.length) nl = before[before.length - 1];
    else {
      nl = nr;
      nr = dates.find((d) => d > nl!) ?? nr;
      if (nl === nr) nl = null;
    }
  }
  return { l: nl, r: nr };
}

/** The collapse fields when the mode changes (Side-by-side collapses and later restores). */
function collapseFor(
  s: Pick<WorkspaceState, "mode" | "layersCollapsed" | "collapsedBeforeSide">,
  next: CompareMode,
): Pick<WorkspaceState, "layersCollapsed" | "collapsedBeforeSide"> {
  if (next === "side" && s.mode !== "side")
    return { layersCollapsed: true, collapsedBeforeSide: s.layersCollapsed };
  if (s.mode === "side" && next !== "side")
    return { layersCollapsed: s.collapsedBeforeSide ?? s.layersCollapsed, collapsedBeforeSide: null };
  return { layersCollapsed: s.layersCollapsed, collapsedBeforeSide: s.collapsedBeforeSide };
}

export function snapshot(s: WorkspaceState): PersistedState {
  return {
    v: 1,
    mode: s.mode,
    l: s.l,
    r: s.r,
    blend: s.blend,
    swipe: s.swipe,
    layers: s.layerState,
    order: s.order,
    view: s.viewInfo,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isDate = (v: unknown): v is string => typeof v === "string" && SURVEY_DATE_RE.test(v);
const isCoord = (v: unknown): v is Coord =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));

/** The persisted state, field by field; anything malformed is left out. */
export function parsePersisted(raw: unknown): Partial<PersistedState> {
  if (!isObj(raw) || raw.v !== 1) return {};
  const out: Partial<PersistedState> = {};
  if (typeof raw.mode === "string" && (COMPARE_MODES as readonly string[]).includes(raw.mode))
    out.mode = raw.mode as CompareMode;
  const { l, r } = raw;
  if (l === null || isDate(l)) out.l = l;
  if (r === null || isDate(r)) out.r = r;
  if (typeof raw.blend === "number") out.blend = raw.blend;
  if (typeof raw.swipe === "number") out.swipe = raw.swipe;
  if (isObj(raw.layers)) {
    const layers: Record<string, LayerUserState> = {};
    for (const [k, v] of Object.entries(raw.layers)) {
      if (isObj(v) && typeof v.visible === "boolean" && typeof v.opacity === "number")
        layers[k] = {
          visible: v.visible,
          opacity: clamp(v.opacity, 0, 100),
          ...(isObj(v.style) ? { style: v.style } : {}),
        };
    }
    out.layers = layers;
  }
  if (isObj(raw.order)) {
    const order: Partial<Record<LayerGroup, string[]>> = {};
    for (const g of GROUP_ORDER) {
      const keys = raw.order[g];
      if (Array.isArray(keys) && keys.every((k) => typeof k === "string")) order[g] = keys as string[];
    }
    out.order = order;
  }
  const view = raw.view;
  if (isObj(view) && isCoord(view.center) && typeof view.resolution === "number" && view.resolution > 0)
    out.view = {
      center: view.center,
      resolution: view.resolution,
      rotation: typeof view.rotation === "number" ? view.rotation : 0,
    };
  return out;
}

export function createWorkspaceStore(): StoreApi<WorkspaceState> {
  return createStore<WorkspaceState>((set, get) => ({
    surveys: [],
    mode: "single",
    l: null,
    r: null,
    blend: 50,
    swipe: 50,
    layersCollapsed: false,
    collapsedBeforeSide: null,
    layerState: {},
    order: {},
    selection: null,
    playing: false,
    wgs84: false,
    pointer: null,
    viewInfo: null,
    initialView: null,
    viewApi: null,
    layers: [],
    layersLoading: true,
    clouds: [],
    frameItems: null,
    stageMenu: null,
    setLayers: (layers, layersLoading) => set({ layers, layersLoading }),
    setClouds: (clouds) => set({ clouds }),
    setFrameItems: (frameItems) => set({ frameItems }),
    openStageMenu: (stageMenu) => set({ stageMenu }),
    closeStageMenu: () => set({ stageMenu: null }),

    setSurveys: (surveys) =>
      set((s) => {
        const mode = s.mode !== "single" && !canCompare(surveys) ? "single" : s.mode;
        return {
          surveys,
          mode,
          ...fixDates(flownDates(surveys), mode, s.l, s.r),
          ...collapseFor(s, mode),
        };
      }),
    setMode: (mode) =>
      set((s) => {
        if (mode === s.mode) return s;
        if (mode !== "single" && !canCompare(s.surveys)) return s;
        return {
          mode,
          ...fixDates(flownDates(s.surveys), mode, s.l, s.r),
          ...collapseFor(s, mode),
        };
      }),
    cycleMode: () => {
      const s = get();
      s.setMode(COMPARE_MODES[(COMPARE_MODES.indexOf(s.mode) + 1) % COMPARE_MODES.length]);
    },
    setDates: (l, r) =>
      set((s) => {
        const dates = flownDates(s.surveys);
        if ((l !== null && !dates.includes(l)) || (r !== null && !dates.includes(r))) return s;
        if (s.mode !== "single" && (l === null || r === null || l >= r)) return s;
        return { l, r };
      }),
    stepRight: (dir) => {
      const s = get();
      const next = stepSurvey(flownDates(s.surveys), s.r, dir, s.mode === "single" ? null : s.l);
      if (next === null) return false;
      set({ r: next });
      return true;
    },
    togglePlay: () => {
      const s = get();
      if (s.playing) {
        set({ playing: false });
        return;
      }
      const dates = flownDates(s.surveys);
      if (dates.length < 2) return;
      let r = s.r;
      if (r === dates[dates.length - 1]) {
        const floor = s.mode === "single" ? null : s.l;
        r = dates.find((d) => floor === null || d > floor) ?? r;
      }
      set({ playing: true, r });
    },
    setPlaying: (on) => set({ playing: on }),
    setBlend: (v) => set({ blend: clamp(v, 0, 100) }),
    setSwipe: (v) => set({ swipe: clamp(v, 2, 98) }),
    toggleLayersCollapsed: () => set((s) => ({ layersCollapsed: !s.layersCollapsed })),
    setLayerState: (key, patch) =>
      set((s) => ({
        layerState: {
          ...s.layerState,
          [key]: {
            visible: true,
            opacity: 100,
            ...(s.layerState[key] as LayerUserState | undefined),
            ...patch,
          },
        },
      })),
    setOrder: (group, keys) => set((s) => ({ order: { ...s.order, [group]: keys } })),
    select: (selection) => set({ selection }),
    toggleWgs84: () => set((s) => ({ wgs84: !s.wgs84 })),
    setPointer: (pointer) => set({ pointer }),
    setViewInfo: (viewInfo) => set({ viewInfo }),
    setViewApi: (viewApi) => set({ viewApi }),
    hydrate: (p) =>
      set((s) => {
        const wanted = p.mode ?? s.mode;
        const mode = wanted !== "single" && !canCompare(s.surveys) ? "single" : wanted;
        return {
          mode,
          ...fixDates(
            flownDates(s.surveys),
            mode,
            p.l !== undefined ? p.l : s.l,
            p.r !== undefined ? p.r : s.r,
          ),
          ...collapseFor(s, mode),
          blend: p.blend !== undefined ? clamp(p.blend, 0, 100) : s.blend,
          swipe: p.swipe !== undefined ? clamp(p.swipe, 2, 98) : s.swipe,
          layerState: p.layers ?? s.layerState,
          order: p.order ?? s.order,
          initialView: p.view ?? s.initialView,
          viewInfo: p.view ?? s.viewInfo,
        };
      }),
  }));
}
