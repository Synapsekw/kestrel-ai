import { IMAGES_KEY_ROWS, registerKeyRows, row, type ImagesKeyRow } from "./bridge";

/**
 * FA's rows of the Images keymap, exactly FC's `FA_ACTIONS` with the `when` FC's collision test
 * expects (FC Task 8 "stays collision-free with FA's rows added"). Keys and help come from F's table.
 */
export function AI_KEY_ROWS(): ImagesKeyRow[] {
  return [
    row("severity", "idle"),
    row("ai-detect", "idle"),
    row("smart-polygon", "always"),
    row("accept", "idle"),
    row("reject", "idle"),
    row("accept-all", "idle"),
    row("reject-all", "idle"),
    row("next-pending", "idle"),
    row("previous-pending", "idle"),
    row("threshold-down", "always"),
    row("threshold-up", "always"),
  ];
}

/** Idempotent; call at module scope before the workspace first renders (FC's keymap reads rows then). */
export function ensureAiRegistered(): void {
  if (!IMAGES_KEY_ROWS.some((r) => r.action === "accept")) registerKeyRows(AI_KEY_ROWS());
}
