import { test, expect } from "@playwright/test";
import { djiFrames, P, serveImages } from "./images/world";
import { openImage } from "./images/ui";

// A new home for the shortcuts-dialog bounds check FW deleted with e2e/contour.spec.ts (hand-off
// from I-FW; controller's handoffs.md, I-E task 11a item B; see `git show 404bfe8 --
// frontend/e2e/contour.spec.ts` for the original). Ported: the canvas leaves room at 1024x768, and
// the "Keyboard shortcuts" sheet (now opened with `?`, not a button — src/app/ShortcutSheet.tsx)
// stays inside the viewport. Adapted from the original: the old editor had no left browser pane, so
// the canvas started at the page's left edge and the dialog's x-bounds check doubled as a viewport
// check; the workspace now docks a 280px browser pane on the left (roomy >= 960px, ImagesWorkspace
// `roomy`) and the shortcuts sheet is a page-level overlay, not scoped to the canvas pane, so it can
// legitimately sit left of the canvas while still being fully on-screen. This checks the sheet
// against the viewport (what actually matters: it must never be clipped or pushed off-screen) rather
// than against the canvas' x-range. Dropped: the old inspector's "Drawing class"/"All
// classes"/Regions assertions — that UI is gone; the type picker is covered by images-annotate.spec.ts.
test("the Images workspace leaves room for the canvas and the shortcuts sheet stays in the viewport", async ({
  page,
}) => {
  const viewport = { width: 1024, height: 768 };
  await page.setViewportSize(viewport);
  const frames = djiFrames();
  await serveImages(page, { frames });
  const canvas = await openImage(page, P, frames[0].id, "800x600");

  const bounds = (await canvas.boundingBox())!;
  expect(bounds.width).toBeGreaterThan(550);
  expect(bounds.height).toBeGreaterThan(400);

  await page.keyboard.press("?");
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
  await expect(shortcuts).toBeVisible();
  const shortcutBounds = (await shortcuts.boundingBox())!;
  expect(shortcutBounds.x).toBeGreaterThanOrEqual(0);
  expect(shortcutBounds.y).toBeGreaterThanOrEqual(0);
  expect(shortcutBounds.x + shortcutBounds.width).toBeLessThanOrEqual(viewport.width);
  expect(shortcutBounds.y + shortcutBounds.height).toBeLessThanOrEqual(viewport.height);
  await expect(shortcuts.locator("tbody tr").first()).toBeInViewport({ ratio: 1 });
});
