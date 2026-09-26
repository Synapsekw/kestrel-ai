import { useEffect, useRef } from "react";
import type { FindingStatus } from "@/api/findings";
import { chordOf, isTypingTarget, keysFor } from "@/ui/keymap";

export interface FindingKeyHandlers {
  onSeverity: (level: number) => void;
  onStatus: (status: FindingStatus) => void;
  onTypePicker: () => void;
  /** +1 next row, -1 previous row. */
  onMove: (delta: 1 | -1) => void;
  /** Returns false when there was nothing to close, so Esc stays free for others. */
  onClose: () => boolean;
}

/**
 * The Findings tab's chords, read from the one app keymap (`keysFor("findings")`): its own J, K and
 * Shift+O/R/C, the review keys 1-9 and T, and the global Escape. Only the actions below are bound.
 */
const HANDLED = new Set([
  "severity",
  "type-picker",
  "cancel",
  "next-row",
  "previous-row",
  "status-open",
  "status-reviewed",
  "status-closed",
]);
const ACTION_OF = new Map<string, string>();
for (const e of keysFor("findings")) {
  if (HANDLED.has(e.action)) for (const k of e.keys) ACTION_OF.set(k, e.action);
}

/** An open dialog, listbox or menu owns its keys (Esc closes it, not the inspector: ambiguity 19). */
function insideOverlay(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest('[role="dialog"],[role="listbox"],[role="menu"]') !== null
  );
}

/**
 * F §5.6 / §8.6 on window: 1-9 severity (levels beyond the scale ignored), Shift+O/R/C status, T the
 * type picker, J/K next/previous finding, Esc close. Nothing fires from a text field or an overlay; a
 * focused DataTable handles J/K/Enter itself and stops them before they reach window.
 */
export function useFindingKeys(enabled: boolean, scaleSize: number, handlers: FindingKeyHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target) || insideOverlay(e.target)) return;
      const action = ACTION_OF.get(chordOf(e));
      if (!action) return;
      const moving = action === "next-row" || action === "previous-row";
      if (e.repeat && !moving) return;
      const h = ref.current;
      switch (action) {
        case "severity": {
          const level = Number(e.key);
          if (level > scaleSize) return;
          h.onSeverity(level);
          break;
        }
        case "status-open":
          h.onStatus("open");
          break;
        case "status-reviewed":
          h.onStatus("reviewed");
          break;
        case "status-closed":
          h.onStatus("closed");
          break;
        case "type-picker":
          h.onTypePicker();
          break;
        case "next-row":
          h.onMove(1);
          break;
        case "previous-row":
          h.onMove(-1);
          break;
        case "cancel":
          if (!h.onClose()) return;
          break;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, scaleSize]);
}
