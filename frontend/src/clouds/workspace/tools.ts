import { cloudShortcut, type CloudNav } from "@/clouds/keys";
import type { ViewName } from "@/clouds/viewer/types";
import type { IconName } from "@/ui";

/** The workspace's tools, in the mockup's palette order (spec §6). */
export type CloudToolId =
  | "orbit"
  | "pan"
  | "fly"
  | "point"
  | "distance"
  | "height"
  | "vertical"
  | "area"
  | "section"
  | "clip"
  | "pin"
  | "photo";

export interface PaletteEntry {
  id: CloudToolId;
  label: string;
  icon: IconName;
  /** The keymap action (ui/keymap.ts); `resolveCloudKey` answers it for `shortcut`. */
  action: string;
  shortcut: string;
  /** The mockup's HINT string. */
  hint: string;
}

const entry = (
  id: CloudToolId,
  label: string,
  icon: IconName,
  action: string,
  hint: string,
  shortcut = cloudShortcut(action),
): PaletteEntry => ({ id, label, icon, action, shortcut, hint });

export const PALETTE: readonly (readonly PaletteEntry[])[] = [
  [
    entry("orbit", "Orbit", "orbit", "orbit", "Drag to orbit · scroll to zoom"),
    // H is F's global pan key (GLOBAL_KEYS "tool-pan"), not a clouds entry.
    entry("pan", "Pan", "pan", "tool-pan", "Drag to pan the view", "H"),
    entry("fly", "Fly", "fly", "fly", "WASD to fly · mouse to look · Esc leaves"),
  ],
  [
    entry("point", "Point", "crosshair", "point", "Click a point to read its coordinates"),
    entry("distance", "Distance", "distance", "measure-length", "Click two points to measure a distance"),
    entry("height", "Height", "height", "height", "Click a base point, then a top point"),
    entry(
      "vertical",
      "Verticality",
      "lean",
      "verticality",
      "Pick two rings on the structure axis to compute lean",
    ),
    entry("area", "Area", "area", "area", "Click to add vertices · double-click to close"),
    entry("section", "Cross-section", "section", "profile", "Draw a line to cut a profile"),
  ],
  [
    entry(
      "clip",
      "Clipping box",
      "clip-box",
      "clipping-box",
      "Click the cloud to centre the box · set its size here",
    ),
  ],
  [
    entry("pin", "Pin a finding", "pin", "finding-marker", "Click the cloud to drop a finding pin"),
    entry(
      "photo",
      "Photo link",
      "camera",
      "photo-link",
      "Click a point to list the drone photos that saw it",
    ),
  ],
];

export const ENTRY = Object.fromEntries(PALETTE.flat().map((e) => [e.id, e])) as Record<
  CloudToolId,
  PaletteEntry
>;

export const NAV_TOOLS: readonly CloudToolId[] = ["orbit", "pan", "fly"];

/** Keymap action → tool. V (F's global "tool-select") also means Orbit in point clouds. */
export const TOOL_OF_ACTION: Record<string, CloudToolId> = {
  ...Object.fromEntries(PALETTE.flat().map((e) => [e.action, e.id])),
  "tool-select": "orbit",
};

export const VIEW_OF_ACTION: Record<string, ViewName> = {
  "view-top": "top",
  "view-front": "front",
  "view-side": "side",
  "view-iso": "iso",
};

export function navOf(id: CloudToolId): CloudNav {
  return id === "fly" ? "fly" : id === "pan" ? "pan" : "orbit";
}

/** The hint bar fades this long after a navigation tool is chosen (spec §6). */
export const HINT_FADE_MS = 2400;
