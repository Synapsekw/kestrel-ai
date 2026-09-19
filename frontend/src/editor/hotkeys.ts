export type EditorAction =
  | { type: "class-key"; key: string }
  | { type: "fit" }
  | { type: "one-to-one" }
  | { type: "delete" }
  | { type: "duplicate" }
  | { type: "accept-all" }
  | { type: "reject-all" }
  | { type: "toggle-empty" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "escape" }
  | { type: "space-down" }
  | { type: "space-up" };

export interface KeyLike {
  type: "keydown" | "keyup";
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat?: boolean;
}

/**
 * Spec section 6 lists both "1:1 (1)" and class hotkeys 1 to 9. Decision: digits select classes,
 * `0` and `Ctrl+1` are 1:1, `F` fits. Letters `a`, `r`, `f`, `n` are editor keys and cannot be
 * class hotkeys.
 */
export function actionForKey(e: KeyLike): EditorAction | null {
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === " ") {
    if (e.type === "keyup") return { type: "space-up" };
    return e.repeat ? null : { type: "space-down" };
  }
  if (e.type !== "keydown") return null;
  const lower = e.key.toLowerCase();
  // A held Ctrl+Z / Ctrl+Y must not fire an undo per auto-repeat tick.
  if (ctrl && e.shiftKey && !e.altKey && lower === "z") return e.repeat ? null : { type: "redo" };
  if (ctrl && !e.shiftKey && !e.altKey) {
    switch (lower) {
      case "z":
        return e.repeat ? null : { type: "undo" };
      case "y":
        return e.repeat ? null : { type: "redo" };
      case "d":
        return { type: "duplicate" };
      case "1":
        return { type: "one-to-one" };
      // Navigation is live while an image loads, so a held key must not walk the whole list.
      case "arrowright":
        return e.repeat ? null : { type: "next" };
      case "arrowleft":
        return e.repeat ? null : { type: "prev" };
      default:
        return null;
    }
  }
  if (ctrl || e.altKey) return null;
  if (e.key === "Escape") return { type: "escape" };
  if (e.key === "Delete" || e.key === "Backspace") return { type: "delete" };
  if (e.shiftKey) return null;
  if (lower === "f") return { type: "fit" };
  if (lower === "0") return { type: "one-to-one" };
  // A held A, R or N must not fire its request once per auto-repeat tick.
  if (lower === "a") return e.repeat ? null : { type: "accept-all" };
  if (lower === "r") return e.repeat ? null : { type: "reject-all" };
  if (lower === "n") return e.repeat ? null : { type: "toggle-empty" };
  if (e.key.length === 1) return { type: "class-key", key: e.key };
  return null;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  // `isContentEditable` is undefined in jsdom, so compare explicitly.
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true;
}

export const HOTKEY_HELP: ReadonlyArray<{ keys: string; does: string }> = [
  { keys: "1-9", does: "select class" },
  { keys: "drag", does: "draw a box with the active class" },
  { keys: "wheel", does: "zoom" },
  { keys: "space + drag", does: "pan" },
  { keys: "F", does: "fit image" },
  { keys: "0 / Ctrl+1", does: "1:1" },
  { keys: "Delete", does: "delete selected box" },
  { keys: "Ctrl+D", does: "duplicate selected box" },
  { keys: "A", does: "accept all visible proposals" },
  { keys: "R", does: "reject all visible proposals" },
  { keys: "N", does: "no machinery on this image (mark empty / undo)" },
  { keys: "Ctrl+Z / Ctrl+Y", does: "undo / redo" },
  { keys: "Ctrl+Right / Ctrl+Left", does: "next / previous image" },
  { keys: "Esc", does: "deselect" },
];
