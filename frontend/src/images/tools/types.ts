import type { ReactNode } from "react";
import type { BoxCreate, ClassDef } from "@contract/client";
import type { BoxWriteResult } from "@/api/shapes";
import type { Point, Size } from "@/images/canvas/geometry";
import type { Draft, ImagesWorkspaceState, ImagesWorkspaceStore, ToolId } from "@/store/imagesWorkspace";
import type { IconName } from "@/ui/Icon";
import type { CameraScale } from "./measure";

export interface ToolPointer {
  image: Point;
  screen: Point;
  shift: boolean;
  alt: boolean;
  button: number;
}

export interface ToolApi {
  store: ImagesWorkspaceStore;
  /** Creates with the active type. With none, keeps the geometry and opens the T picker. */
  createShape: (body: Omit<BoxCreate, "class_id">) => Promise<BoxWriteResult | undefined>;
  /** Keeps a mark drawn before a type exists, and opens the picker so it can be named or chosen. */
  holdShape: (body: Omit<BoxCreate, "class_id">) => void;
  createMeasurement: (a: Point, b: Point) => Promise<void>;
  openPicker: (purpose: "active" | "retype") => void;
  notify: (text: string, tone?: "info" | "ok" | "danger") => void;
}

export interface DraftContext {
  scale: number;
  colour: string;
  camera: CameraScale | null;
  image: Size;
}

export interface ToolDefinition {
  id: ToolId;
  order: number;
  /** The F keymap action this tool answers to (ui/keymap.ts), e.g. "box" for B. */
  action: string;
  icon: IconName;
  label: string;
  /** The tooltip sub-line of spec §6.2 ("Click to segment with AI", "mm from GSD"). */
  hint: string;
  /** The status bar's left side while this tool is active (spec §6.4). */
  statusHints: string;
  cursor: "default" | "crosshair" | "grab";
  /** True: shapes ignore the pointer and the stage routes every press here. */
  drawsShapes: boolean;
  typeFilter?: (t: ClassDef) => boolean;
  /** null when usable, else the reason (shown as a toast and in the palette tooltip). */
  available?: (s: ImagesWorkspaceState) => string | null;
  onDown?: (p: ToolPointer, api: ToolApi) => void;
  onMove?: (p: ToolPointer, api: ToolApi) => void;
  onUp?: (p: ToolPointer, api: ToolApi) => void;
  /** Enter. Return true when handled. */
  onCommit?: (api: ToolApi) => boolean;
  /** Esc. Return true when handled (a draft was cancelled). */
  onCancel?: (api: ToolApi) => boolean;
  /** Backspace, and Ctrl+Z while drawing. Return true when handled. */
  onRemoveVertex?: (api: ToolApi) => boolean;
  renderDraft?: (draft: Draft, ctx: DraftContext) => ReactNode;
  onActivate?: (api: ToolApi) => void;
  onDeactivate?: (api: ToolApi) => void;
}
