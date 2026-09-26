import { useEffect, useRef, useState } from "react";

export const NOTE_AUTOSAVE_MS = 600;
export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Saves `value` `delay` ms after it last changed, unless it equals `saved`. A value still waiting
 * when the component unmounts (the inspector switched findings) is saved at once, through the
 * `save` of the render that typed it, so it lands on its own finding.
 */
export function useAutosave(
  value: string,
  saved: string,
  save: (v: string) => Promise<void>,
  delay = NOTE_AUTOSAVE_MS,
): SaveState {
  const [state, setState] = useState<SaveState>("idle");
  const saveRef = useRef(save);
  const pending = useRef<string | null>(null);
  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    if (value === saved) {
      pending.current = null;
      return;
    }
    pending.current = value;
    const timer = window.setTimeout(() => {
      pending.current = null;
      setState("saving");
      saveRef.current(value).then(
        () => setState("saved"),
        () => setState("error"),
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [value, saved, delay]);

  useEffect(
    () => () => {
      if (pending.current !== null) void saveRef.current(pending.current).catch(() => undefined);
    },
    [],
  );

  return state;
}
