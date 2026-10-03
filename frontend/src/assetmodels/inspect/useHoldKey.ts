import { useEffect, useRef } from "react";
import { chordOf, isTypingTarget, normaliseChord } from "@/ui";

/**
 * Calls `onChange(true)` when `chord` goes down and `onChange(false)` when it comes up (or the window
 * loses focus mid-hold). For hold-to-compare: `useToolShortcuts` binds key-down only.
 */
export function useHoldKey(chord: string, onChange: (held: boolean) => void, enabled = true): void {
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
  }, [chord, enabled]);
}
