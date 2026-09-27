import { useLayoutEffect } from "react";
import { getTool } from "@/images/tools/registry";
import { useImagesWorkspace, type ImagesWorkspaceState, type ToolId } from "@/store/imagesWorkspace";
import { isTypingTarget, keysFor, normaliseChord, useToolShortcuts, type ToolShortcut } from "@/ui/keymap";

/**
 * The Images workspace's keys (spec §13): F's `images`, global and review entries (ui/keymap.ts),
 * each annotated with when it applies. Keys and help always come from F's table, so the ? sheet,
 * the status bar and this dispatch never disagree (Deviation D2).
 */
export type KeyWhen = "always" | "idle" | "drawing" | "selection";

export interface ImagesKeyRow {
  keys: string[];
  when: KeyWhen;
  action: string;
  help: string;
}

const F_ENTRIES = keysFor("images");

/** A row for one F action; an action F lists twice (F and 0 are both `fit`) gets all its keys. */
export function row(action: string, when: KeyWhen): ImagesKeyRow {
  const entries = F_ENTRIES.filter((e) => e.action === action);
  if (entries.length === 0)
    throw new Error(`"${action}" is not an images, global or review key in ui/keymap.ts`);
  return { keys: entries.flatMap((e) => e.keys), when, action, help: entries[0].help };
}

/**
 * The actions FA binds in batch 3 (D, S, A, X, Shift+A/X, Tab, Shift+Tab, [ and ], and 1–9: the FA
 * plan's R-FA3 gives FA the severity digits, so "A, 3" works without FW).
 */
export const FA_ACTIONS: readonly string[] = [
  "severity",
  "ai-detect",
  "smart-polygon",
  "accept",
  "reject",
  "accept-all",
  "reject-all",
  "next-pending",
  "previous-pending",
  "threshold-down",
  "threshold-up",
];

/** FC's rows, and FW's (N, C, arrows, pane toggles, Shift+M); FA adds its own with registerKeyRows. */
export const IMAGES_KEY_ROWS: ImagesKeyRow[] = [
  row("tool-select", "always"),
  row("tool-pan", "always"),
  row("box", "always"),
  row("rotated-box", "always"),
  row("polygon", "always"),
  row("finding-marker", "always"),
  row("measure-length", "always"),
  row("cancel", "always"),
  row("commit", "drawing"),
  row("remove-vertex", "drawing"),
  row("delete", "selection"),
  row("undo", "always"),
  row("redo", "idle"),
  row("fit", "always"),
  row("zoom-in", "always"),
  row("zoom-out", "always"),
  row("one-to-one", "always"),
  row("duplicate", "selection"),
  row("rotate", "selection"),
  row("nudge", "selection"),
  row("annotations-toggle", "always"),
  row("suggestions-toggle", "always"),
  row("type-picker", "idle"),
  row("nothing-to-report", "idle"),
  row("focus-comment", "always"),
  row("previous-image", "idle"),
  row("next-image", "idle"),
  row("toggle-browser", "always"),
  row("toggle-inspector", "always"),
  row("grid-map", "always"),
];

export function whenOverlaps(a: KeyWhen, b: KeyWhen): boolean {
  if (a === "always" || b === "always" || a === b) return true;
  if (a === "drawing" || b === "drawing") return false;
  return true; // idle and selection
}

export function findRowCollisions(
  rows: readonly ImagesKeyRow[],
): Array<{ chord: string; a: ImagesKeyRow; b: ImagesKeyRow }> {
  const out: Array<{ chord: string; a: ImagesKeyRow; b: ImagesKeyRow }> = [];
  for (let x = 0; x < rows.length; x++) {
    for (let y = x + 1; y < rows.length; y++) {
      if (!whenOverlaps(rows[x].when, rows[y].when)) continue;
      for (const chord of rows[x].keys)
        if (rows[y].keys.includes(chord)) out.push({ chord, a: rows[x], b: rows[y] });
    }
  }
  return out;
}

/** Adds rows (FA); refuses any that would fire together with an existing one. */
export function registerKeyRows(rows: ImagesKeyRow[]): void {
  const clashes = findRowCollisions([...IMAGES_KEY_ROWS, ...rows]);
  if (clashes.length) {
    throw new Error(
      clashes.map((c) => `${c.chord}: ${c.a.action}/${c.a.when} vs ${c.b.action}/${c.b.when}`).join("; "),
    );
  }
  IMAGES_KEY_ROWS.push(...rows);
}

export function whenMatches(
  when: KeyWhen,
  s: Pick<ImagesWorkspaceState, "draft" | "selectedIds" | "selectedMeasurementId">,
): boolean {
  const drawing = s.draft !== null;
  if (when === "always") return true;
  if (when === "drawing") return drawing;
  if (when === "idle") return !drawing;
  return !drawing && (s.selectedIds.length > 0 || s.selectedMeasurementId !== null);
}

/** Return false to let the next layer handle the key. */
export type KeyHandler = (chord: string) => boolean | void;
export type KeyHandlers = Partial<Record<string, KeyHandler>>;

/**
 * Binds the rows through F's useToolShortcuts: one shortcut per chord, with F's action for it.
 * At key time it reads the store, picks the row whose `when` matches, and calls the first layer
 * whose handler for that action does not return false (ruling FC-R11).
 *
 * Shortcuts are rebuilt fresh every render, closing over the current `layers`: F's
 * `useToolShortcuts` already keeps the newest array it was given (its own internal ref, updated
 * in a passive effect each render), so there is no need to hold a second ref here.
 */
export function useImagesKeymap(
  layers: readonly KeyHandlers[],
  opts: { enabled?: boolean; rows?: readonly ImagesKeyRow[] } = {},
): void {
  const rows = opts.rows ?? IMAGES_KEY_ROWS;
  const byChord = new Map<string, ImagesKeyRow[]>();
  for (const r of rows)
    for (const k of r.keys) {
      const chord = normaliseChord(k);
      byChord.set(chord, [...(byChord.get(chord) ?? []), r]);
    }
  const shortcuts: ToolShortcut[] = [...byChord.entries()].map(([chord, candidates]) => ({
    shortcut: chord,
    action: candidates[0].action,
    onTrigger: () => {
      const s = useImagesWorkspace.getState();
      const hit = candidates.find((r) => whenMatches(r.when, s));
      if (!hit) return;
      for (const layer of layers) {
        const handler = layer[hit.action];
        if (handler && handler(chord) !== false) return;
      }
    },
  }));
  useToolShortcuts(shortcuts, opts.enabled ?? true);
}

/**
 * Space, Shift and Alt held (pan from any tool, rotate snaps, Alt+click). A layout effect, as in
 * the old editor: a passive one lands a task late and drops the first key after an image appears.
 */
export function useHeldKeys(): void {
  useLayoutEffect(() => {
    const st = () => useImagesWorkspace.getState();
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === " ") {
        e.preventDefault();
        if (!st().spaceHeld) st().setHeld({ space: true });
      } else if (e.key === "Shift" && !st().shiftHeld) st().setHeld({ shift: true });
      else if (e.key === "Alt") {
        // WebView2 moves focus to a (non-existent) menu bar on a bare Alt otherwise.
        e.preventDefault();
        if (!st().altHeld) st().setHeld({ alt: true });
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") st().setHeld({ space: false });
      else if (e.key === "Shift") st().setHeld({ shift: false });
      else if (e.key === "Alt") st().setHeld({ alt: false });
    };
    const blur = () => st().setHeld({ space: false, shift: false, alt: false });
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      blur();
    };
  }, []);
}

/** The status bar's left side for a tool (spec §6.4). */
export function statusHintsFor(tool: ToolId): string {
  return getTool(tool)?.statusHints ?? "";
}
