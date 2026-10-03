import { useEffect, useRef } from "react";
import { insideModal, isTypingTarget } from "@/ui/keymap";

export function isSidebarChord(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b";
}

/** Ctrl+B shows or hides the sidebar, except while typing in a field or behind a modal dialog (spec 2026-10-03-sidebar §4). */
export function useSidebarShortcut(onToggle: () => void): void {
  const latest = useRef(onToggle);
  useEffect(() => {
    latest.current = onToggle;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.repeat ||
        !isSidebarChord(e) ||
        isTypingTarget(e.target) ||
        insideModal(e.target)
      )
        return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
