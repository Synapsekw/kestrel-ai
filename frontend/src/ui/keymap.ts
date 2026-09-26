import { useEffect, useRef } from "react";

/**
 * The one app keymap (spec §5.6). Global and review keys mean the same everywhere; each workspace
 * owns only its tool keys, and none may equal a global or review key (keymap.test.tsx walks it).
 * I, M and C bind handlers to these entries through useToolShortcuts; the ? sheet and hint bars
 * render from them. The `findings` scope is reserved empty here: S1 fills J, K and Shift+O/R/C in
 * it; Enter stays global (it already means "commit") and DataTable handles it.
 */

export type WorkspaceScope = "images" | "maps" | "clouds" | "clouds.fly" | "findings";
export type KeyScope = "global" | "review" | WorkspaceScope;

export interface KeyEntry {
  /** Canonical chords (see chordOf). */
  keys: string[];
  scope: KeyScope;
  /** What the key does; the same action keeps the same id in every scope. */
  action: string;
  /** One line for the ? sheet and hint bars. */
  help: string;
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Keys never fire while focus is in a text field. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  // `isContentEditable` is undefined in jsdom, so compare explicitly.
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true;
}

const NAMED: Record<string, string> = { " ": "Space", Spacebar: "Space", Esc: "Escape", Del: "Delete" };

/**
 * `Ctrl+Alt+Shift+Key`: modifiers in that order, letters upper-case (so keys are case-insensitive),
 * named keys as KeyboardEvent.key. Meta counts as Ctrl. Shift is written only for letters and named
 * keys, because "?" and "+" already carry it in the character.
 */
export function chordOf(e: KeyLike): string {
  let key = NAMED[e.key] ?? e.key;
  const letter = /^[a-z]$/i.test(key);
  if (letter) key = key.toUpperCase();
  const named = key.length > 1;
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey && (letter || named)) mods.push("Shift");
  return [...mods, key].join("+");
}

function splitChord(chord: string): string[] {
  if (chord === "+") return ["+"];
  if (chord.endsWith("++")) return [...chord.slice(0, -2).split("+"), "+"];
  return chord.split("+");
}

export function normaliseChord(chord: string): string {
  const parts = splitChord(chord);
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return chordOf({
    key,
    ctrlKey: mods.has("ctrl"),
    metaKey: mods.has("meta") || mods.has("cmd"),
    altKey: mods.has("alt"),
    shiftKey: mods.has("shift"),
  });
}

const GLYPH: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  Delete: "Del",
};

/** A chord as key-cap labels, for Kbd. */
export function formatChord(chord: string): string[] {
  return splitChord(chord).map((part) => GLYPH[part] ?? part);
}

const entry =
  (scope: KeyScope) =>
  (keys: string | string[], action: string, help: string): KeyEntry => ({
    keys: Array.isArray(keys) ? keys : [keys],
    scope,
    action,
    help,
  });
const g = entry("global");
const r = entry("review");
const i = entry("images");
const m = entry("maps");
const c = entry("clouds");
const fly = entry("clouds.fly");

export const GLOBAL_KEYS: KeyEntry[] = [
  g("Ctrl+K", "palette", "Command palette"),
  g("?", "shortcuts", "Shortcuts for this screen"),
  g("Escape", "cancel", "Cancel the draft or tool; again to deselect"),
  g("Enter", "commit", "Commit the draft or save the tool's result"),
  g("Backspace", "remove-vertex", "Remove the last vertex while drawing"),
  g("Delete", "delete", "Delete the selection"),
  g("Ctrl+Z", "undo", "Undo (while drawing, remove the last vertex)"),
  g("Ctrl+Y", "redo", "Redo"),
  g("Space", "pan-hold", "Hold to pan from any tool"),
  g("V", "tool-select", "Select tool (Orbit in point clouds)"),
  g("H", "tool-pan", "Pan tool"),
  g("F", "fit", "Fit the image, the site or the cloud"),
  g("+", "zoom-in", "Zoom in"),
  g("-", "zoom-out", "Zoom out"),
];

export const REVIEW_KEYS: KeyEntry[] = [
  r("A", "accept", "Accept the focused suggestion or detection"),
  r("X", "reject", "Reject the focused suggestion or detection"),
  r("Shift+A", "accept-all", "Accept all visible pending items"),
  r("Shift+X", "reject-all", "Reject all visible pending items"),
  r(["1", "2", "3", "4", "5", "6", "7", "8", "9"], "severity", "Set the severity level"),
  r("T", "type-picker", "Pick the type"),
  r("Tab", "next-pending", "Next pending item"),
  r("Shift+Tab", "previous-pending", "Previous pending item"),
];

export const WORKSPACE_KEYS: Record<WorkspaceScope, KeyEntry[]> = {
  images: [
    i("B", "box", "Box"),
    i("R", "rotated-box", "Rotated box"),
    i("P", "polygon", "Polygon"),
    i("S", "smart-polygon", "Smart polygon"),
    i("M", "finding-marker", "Point marker"),
    i("L", "measure-length", "Measure length"),
    i("D", "ai-detect", "AI detect"),
    i("G", "suggestions-toggle", "Show or hide suggestions"),
    i("Shift+H", "annotations-toggle", "Show or hide annotations"),
    i("N", "nothing-to-report", "Nothing to report on this image"),
    i("C", "focus-comment", "Write a comment"),
    i("ArrowLeft", "previous-image", "Previous image"),
    i("ArrowRight", "next-image", "Next image"),
    i(["Shift+ArrowLeft", "Shift+ArrowRight"], "rotate", "Rotate the rotated box"),
    i(["Alt+ArrowUp", "Alt+ArrowDown", "Alt+ArrowLeft", "Alt+ArrowRight"], "nudge", "Nudge the selection"),
    i("0", "fit", "Fit the image"),
    i("Ctrl+1", "one-to-one", "Actual size"),
    i("Ctrl+D", "duplicate", "Duplicate the selection"),
    i("[", "threshold-down", "Lower the confidence threshold"),
    i("]", "threshold-up", "Raise the confidence threshold"),
    i("Ctrl+[", "toggle-browser", "Show or hide the image browser"),
    i("Ctrl+]", "toggle-inspector", "Show or hide the inspector"),
    i("Shift+M", "grid-map", "Switch between grid and capture map"),
  ],
  maps: [
    m("L", "measure-length", "Distance"),
    m("Q", "area", "Area"),
    m("E", "profile", "Elevation profile"),
    m("U", "volume", "Volume"),
    m("M", "finding-marker", "Finding point"),
    m("G", "finding-polygon", "Finding polygon"),
    m("Z", "zone", "Zone"),
    m("K", "align-drawing", "Align a drawing"),
    m("D", "ai-detect", "AI detect in a region"),
    m("[", "previous-survey", "Previous survey"),
    m("]", "next-survey", "Next survey"),
    m("P", "play", "Play the survey timeline"),
    m("C", "compare-mode", "Cycle the compare mode"),
    m("Shift+N", "north-up", "North up"),
  ],
  clouds: [
    c("O", "orbit", "Orbit"),
    c("W", "fly", "Fly"),
    c("P", "point", "Point"),
    c("L", "measure-length", "Distance"),
    c("Z", "height", "Height"),
    c("U", "verticality", "Verticality"),
    c("Q", "area", "Area"),
    c("E", "profile", "Cross-section"),
    c("C", "clipping-box", "Clipping box"),
    c("M", "finding-marker", "Pin a finding"),
    c("I", "photo-link", "Source photo"),
    c("N", "next-ring", "Next ring"),
    c("Alt+1", "view-top", "Top view"),
    c("Alt+2", "view-front", "Front view"),
    c("Alt+3", "view-side", "Side view"),
    c("Alt+4", "view-iso", "Iso view"),
  ],
  // Fly mode (pointer lock) suspends the review keys until Esc; only global keys stay reserved.
  "clouds.fly": [
    fly("W", "move-forward", "Fly forward"),
    fly("A", "move-left", "Fly left"),
    fly("S", "move-back", "Fly back"),
    fly("D", "move-right", "Fly right"),
    fly("Q", "move-down", "Fly down"),
    fly("E", "move-up", "Fly up"),
  ],
  // Reserved for S1: J, K and Shift+O/R/C on the Findings tab's DataTable.
  findings: [],
};

export const KEYMAP: KeyEntry[] = [...GLOBAL_KEYS, ...REVIEW_KEYS, ...Object.values(WORKSPACE_KEYS).flat()];

export interface Collision {
  chord: string;
  a: KeyEntry;
  b: KeyEntry;
}

function clash(a: KeyScope, b: KeyScope): boolean {
  if (a === b) return true;
  if (a === "global" || b === "global") return true;
  if (a === "review" || b === "review") return a !== "clouds.fly" && b !== "clouds.fly";
  return false;
}

/** Pairs that would fire together: same scope, or a key that is global or review elsewhere. */
export function findCollisions(entries: readonly KeyEntry[]): Collision[] {
  const flat = entries.flatMap((e) => e.keys.map((chord) => ({ chord, e })));
  const out: Collision[] = [];
  for (let x = 0; x < flat.length; x++) {
    for (let y = x + 1; y < flat.length; y++) {
      if (flat[x].chord === flat[y].chord && clash(flat[x].e.scope, flat[y].e.scope)) {
        out.push({ chord: flat[x].chord, a: flat[x].e, b: flat[y].e });
      }
    }
  }
  return out;
}

/** The keys live on a screen: global, review, and the workspace's own (for the ? sheet). */
export function keysFor(scope: WorkspaceScope | null): KeyEntry[] {
  return [...GLOBAL_KEYS, ...REVIEW_KEYS, ...(scope ? WORKSPACE_KEYS[scope] : [])];
}

export interface ToolShortcut {
  shortcut?: string;
  /** The KeyEntry action this tool performs; required to bind a global key such as V or F. */
  action?: string;
  onTrigger: () => void;
  disabled?: boolean;
}

const SHARED = new Map<string, string>();
for (const e of [...GLOBAL_KEYS, ...REVIEW_KEYS]) for (const k of e.keys) SHARED.set(k, e.action);

function refused(tool: ToolShortcut): boolean {
  if (!tool.shortcut) return false;
  const owner = SHARED.get(normaliseChord(tool.shortcut));
  return owner !== undefined && owner !== tool.action;
}

/**
 * Binds the tools' shortcuts on window while mounted (and `enabled`). Ignores key repeat, modified
 * events that were already handled, and keys typed into text fields. A tool may not take a global or
 * review key unless it is that key's action.
 */
export function useToolShortcuts(tools: readonly ToolShortcut[], enabled = true): void {
  const latest = useRef(tools);
  useEffect(() => {
    latest.current = tools;
  });
  const signature = tools.map((t) => `${t.shortcut ?? ""}:${t.action ?? ""}`).join("|");
  useEffect(() => {
    for (const tool of latest.current) {
      if (refused(tool)) {
        console.error(
          `useToolShortcuts: "${tool.shortcut}" is a global or review key; not bound (spec §5.6)`,
        );
      }
    }
  }, [signature]);
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || isTypingTarget(e.target)) return;
      const chord = chordOf(e);
      const tool = latest.current.find(
        (t) => !t.disabled && t.shortcut !== undefined && !refused(t) && normaliseChord(t.shortcut) === chord,
      );
      if (!tool) return;
      e.preventDefault();
      tool.onTrigger();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
