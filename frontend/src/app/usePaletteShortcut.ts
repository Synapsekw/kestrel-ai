import { useEffect, useState } from "react";

export function isPaletteChord(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
}

/**
 * Ctrl K from anywhere, including text fields and work surfaces (spec 2026-09-26-foundation
 * section 5.4): caught in the capture phase on window, so no screen's own key handler sees it.
 */
export function usePaletteShortcut(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteChord(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return [open, setOpen];
}
