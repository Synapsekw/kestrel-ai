import type { ComponentType } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { GLOBAL_KEYS, WORKSPACE_KEYS, type IconName } from "@/ui";
import { Registry } from "../registry";
import type { Coord, Selection, SiteFrame, Survey, WorkspaceLayer } from "../types";
import type { SiteExtent } from "../view/siteGrid";
import type { MapTopicId } from "../topics/topicIds";

export type DrawSpec =
  | { shape: "none" }
  | { shape: "point" }
  | { shape: "line"; min: number; max?: number }
  | { shape: "polygon"; min: number }
  | { shape: "box" };

/** What a tool may look at to decide whether it is usable. */
export interface ToolContext {
  frame: SiteFrame;
  selection: Selection | null;
  surveys: readonly Survey[];
  layers: readonly WorkspaceLayer[];
  r: string | null;
}

export interface ToolOverlayProps {
  projectId: string;
  frame: SiteFrame;
}

export interface MapTool {
  id: string;
  /** The rail topic whose panel holds this tool (spec §3.1); "nav" sits on the rail itself. */
  topic: MapTopicId | "nav";
  /** Position inside the topic. */
  order: number;
  icon: IconName;
  /** "Measure distance": the tooltip and the hint pill's bold name. */
  label: string;
  /** The ui/keymap.ts action (a `maps` entry, or tool-select / tool-pan); the key is read from there. */
  action: string;
  /** The hint pill after the name: "Click vertices · double-click or Enter finishes · Esc cancels". */
  hint: string;
  draw: DrawSpec;
  /** null when usable; otherwise why not (shown as the button's name and tooltip). */
  disabledReason?: (ctx: ToolContext) => string | null;
  /** Mounted over the stage while the tool is active: popovers, live labels, saving. */
  Overlay?: ComponentType<ToolOverlayProps>;
}

export type Geometry =
  | { type: "Point"; coordinates: Coord }
  | { type: "LineString"; coordinates: Coord[] }
  | { type: "Polygon"; coordinates: Coord[][] }
  | { type: "Box"; extent: SiteExtent };

/** A finished drawing in site coordinates, waiting for the tool's Overlay to save it or drop it. */
export interface Completed {
  toolId: string;
  geometry: Geometry;
}

/** Spec §9.1: a drawn geometry has at most 5 000 vertices. */
export const MAX_VERTICES = 5000;

/** The tool ids and their keymap actions, fixed for sub-project M (Task 6 table). */
export const MAP_TOOL_ACTIONS = {
  select: "tool-select",
  pan: "tool-pan",
  distance: "measure-length",
  area: "area",
  profile: "profile",
  volume: "volume",
  "finding-point": "finding-marker",
  "finding-polygon": "finding-polygon",
  zone: "zone",
  "align-drawing": "align-drawing",
  "ai-region": "ai-detect",
} as const;

/** The `maps` keys the workspace binds itself (useWorkspaceKeys). */
export const WORKSPACE_ACTIONS = [
  "previous-survey",
  "next-survey",
  "play",
  "compare-mode",
  "north-up",
] as const;

export const toolRegistry = new Registry<MapTool>();
export const registerTool = (tool: MapTool): (() => void) => toolRegistry.register(tool);

const TOOL_KEYS = [...WORKSPACE_KEYS.maps, ...GLOBAL_KEYS.filter((e) => e.action.startsWith("tool-"))];

/** The chord of a tool action; undefined for a review key, a non-tool global key or an unknown action. */
export function shortcutFor(action: string): string | undefined {
  return TOOL_KEYS.find((e) => e.action === action)?.keys[0];
}

/** One topic's tools, by `order` then id. */
export function toolsOfTopic(tools: readonly MapTool[], topic: MapTopicId | "nav"): MapTool[] {
  return tools.filter((t) => t.topic === topic).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export interface ToolState {
  active: string;
  /** Vertices of the drawing in progress, in site coordinates. */
  draft: Coord[];
  completed: Completed | null;
  /** Space held: pan from any tool. */
  panHold: boolean;
  activate: (id: string) => void;
  addVertex: (c: Coord) => void;
  removeVertex: () => void;
  /** Enter or double-click; `tolerance` (site units) merges the double-click's repeated vertex. */
  finish: (tolerance?: number) => void;
  completeBox: (extent: SiteExtent) => void;
  /** Esc (R-W1-13): what it dropped. The caller clears the selection on "nothing". */
  cancel: () => "draft" | "completed" | "nothing";
  clearCompleted: () => void;
  setPanHold: (on: boolean) => void;
}

const near = (a: Coord, b: Coord, tol: number): boolean => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

function dedupe(v: readonly Coord[], tol: number): Coord[] {
  return v.filter((c, i) => i === 0 || !near(c, v[i - 1], tol));
}

export function createToolStore(
  lookup: (id: string) => MapTool | undefined = (id) => toolRegistry.get(id),
): StoreApi<ToolState> {
  return createStore<ToolState>((set, get) => {
    const complete = (geometry: Geometry) =>
      set({ draft: [], completed: { toolId: get().active, geometry } });
    return {
      active: "select",
      draft: [],
      completed: null,
      panHold: false,
      activate: (id) => {
        if (!lookup(id)) return;
        set({ active: id, draft: [], completed: null });
      },
      addVertex: (c) => {
        const s = get();
        const draw = lookup(s.active)?.draw;
        if (!draw || s.completed) return;
        if (draw.shape === "point") {
          complete({ type: "Point", coordinates: c });
          return;
        }
        if (draw.shape !== "line" && draw.shape !== "polygon") return;
        if (s.draft.length >= MAX_VERTICES) return;
        const last = s.draft[s.draft.length - 1];
        if (last && near(last, c, 0)) return;
        const draft = [...s.draft, c];
        if (draw.shape === "line" && draw.max !== undefined && draft.length >= draw.max) {
          complete({ type: "LineString", coordinates: draft });
          return;
        }
        set({ draft });
      },
      removeVertex: () => set((s) => (s.draft.length ? { draft: s.draft.slice(0, -1) } : s)),
      finish: (tolerance = 0) => {
        const s = get();
        const draw = lookup(s.active)?.draw;
        const v = dedupe(s.draft, tolerance);
        if (draw?.shape === "line" && v.length >= draw.min) complete({ type: "LineString", coordinates: v });
        else if (draw?.shape === "polygon" && v.length >= draw.min)
          complete({ type: "Polygon", coordinates: [[...v, v[0]]] });
      },
      completeBox: (extent) => {
        if (lookup(get().active)?.draw.shape !== "box") return;
        if (extent[2] <= extent[0] || extent[3] <= extent[1]) return;
        complete({ type: "Box", extent });
      },
      cancel: () => {
        const s = get();
        if (s.draft.length) {
          set({ draft: [] });
          return "draft";
        }
        if (s.completed) {
          set({ completed: null });
          return "completed";
        }
        return "nothing";
      },
      clearCompleted: () => set({ completed: null }),
      setPanHold: (on) => set((s) => (s.panHold === on ? s : { panHold: on })),
    };
  });
}
