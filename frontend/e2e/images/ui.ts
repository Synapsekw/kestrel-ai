import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Every UI hook the Images e2e flows use, in one place (plan 2026-09-27-images-e, Task 1). The
 * names were guessed when the plan was written and reconciled against the merged I units; if a
 * component changes a test id, this is the only file to edit.
 */

/** The Konva layer names of spec §9.1 (FC). The perf probe finds layers by these. */
export const ANNOTATION_LAYER = "annotations";
export const SUGGESTION_LAYER = "suggestions";

export function ws(page: Page) {
  const grid = page.getByTestId("browser-grid");
  return {
    canvas: page.getByTestId("image-canvas"),
    grid,
    gridTiles: grid.getByTestId("image-thumb"),
    allTiles: page.getByTestId("image-thumb"),
    currentTile: grid.locator('[data-testid="image-thumb"][aria-current="true"]'),
    gridCaption: page.getByTestId("grid-caption"),
    browserView: page.getByRole("radiogroup", { name: "Browser view" }),
    captureMap: page.getByTestId("capture-map-host"),
    infoChip: page.getByTestId("image-info-chip"),
    statusBar: page.getByTestId("images-status-bar"),
    saveState: page.getByTestId("save-state"),
    hintBar: page.getByTestId("ai-hint-bar"),
    modelMenu: page.getByRole("dialog", { name: "Run a library model on this image" }),
    typePicker: page.getByRole("dialog", { name: "Choose a type" }),
    inspector: page.getByTestId("inspector-column"),
    severity: page.getByTestId("inspector-column").getByRole("radiogroup", { name: "Severity" }),
    note: page.getByTestId("inspector-column").getByRole("textbox", { name: "Note" }),
    measureReadout: page.getByTestId("measure-readout"),
  };
}

/** Opens `/p/{projectId}/images/{imageId}` and waits until the canvas has the frame. */
export async function openImage(
  page: Page,
  projectId: string,
  imageId: string,
  size: string,
): Promise<Locator> {
  await page.goto(`/p/${projectId}/images/${imageId}`);
  const canvas = ws(page).canvas;
  await expect(canvas).toHaveAttribute("data-image", size, { timeout: 15_000 });
  return canvas;
}

export async function readView(page: Page) {
  const canvas = ws(page).canvas;
  return {
    scale: Number(await canvas.getAttribute("data-view-scale")),
    x: Number(await canvas.getAttribute("data-view-x")),
    y: Number(await canvas.getAttribute("data-view-y")),
  };
}

/** Page coordinates of a stored-image pixel. */
export async function toScreen(page: Page, ix: number, iy: number) {
  const box = await ws(page).canvas.boundingBox();
  if (!box) throw new Error("canvas not laid out");
  const v = await readView(page);
  return { x: box.x + ix * v.scale + v.x, y: box.y + iy * v.scale + v.y };
}

/** "6,912 mm ± 278 mm", "6.91 m ± 0.28 m" or "691 cm" -> the first length, in millimetres. */
export function parseLengthMm(text: string): number {
  const m = /([\d.,]+)\s*(mm|cm|m)\b/.exec(text.replace(/ /g, " "));
  if (!m) throw new Error(`no length in "${text}"`);
  const value = Number(m[1].replace(/,/g, ""));
  return m[2] === "m" ? value * 1000 : m[2] === "cm" ? value * 10 : value;
}
