import type { KeyboardEvent } from "react";

/**
 * For the root of an FA overlay (BulkConfirm, ModelMenu). F's `useToolShortcuts` prevents the
 * default of every chord it binds, and FA binds Tab / Shift+Tab (the suggestion walk), so a Tab
 * reaching the window would stop focus moving inside the overlay. Stopping it here keeps it from
 * the window listener; the default is left alone so the focus trap and the browser still move focus.
 */
export function stopTabPropagation(e: KeyboardEvent): void {
  if (e.key === "Tab") e.stopPropagation();
}
