import { useEffect, useRef } from "react";
import { chordOf, isTypingTarget, normaliseChord } from "@/ui";

/**
 * The key belongs to the hold only when nothing else has focus (the body) or focus is inside `zone`
 * (a selector), and never inside a modal dialog: a focused button, radio, slider or select keeps its
 * own key (Space presses a button), as `canvasOwnsSpace` in the images keymap.
 */
export function holdOwnsKey(target: EventTarget | null, zone: string): boolean {
  if (!(target instanceof Element)) return true; // window or document: nothing focused
  if (target.closest('[aria-modal="true"]')) return false;
  return target === document.body || (zone !== "" && target.closest(zone) !== null);
}

/**
 * Calls `onChange(true)` when `chord` goes down and `onChange(false)` when it comes up (or the window
 * loses focus mid-hold). For hold-to-compare: `useToolShortcuts` binds key-down only. The key is taken
 * (and default-prevented) only where `holdOwnsKey` says so.
 */
export function useHoldKey(
  chord: string,
  onChange: (held: boolean) => void,
  enabled = true,
  zone = "",
): void {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });
  useEffect(() => {
    if (!enabled) return;
    const want = normaliseChord(chord);
    let held = false;
    const set = (on: boolean) => {
      if (held === on) return;
      held = on;
      cb.current(on);
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented || isTypingTarget(e.target) || chordOf(e) !== want) return;
      if (!holdOwnsKey(e.target, zone)) return;
      e.preventDefault();
      set(true);
    };
    const up = (e: KeyboardEvent) => {
      if (chordOf(e) === want || e.key === " ") set(false);
    };
    const blur = () => set(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      if (held) cb.current(false);
    };
  }, [chord, enabled, zone]);
}
