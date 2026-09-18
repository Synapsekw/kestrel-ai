import { test, expect, type Page } from "@playwright/test";

export const P = "7f1c2e3a-1111-4000-8000-000000000001";
export const IMG = "10000000-5555-4000-8000-000000000001";

export async function openEditor(page: Page) {
  await page.goto(`/p/${P}/edit/${IMG}`);
  const canvas = page.getByTestId("editor-canvas");
  await expect(canvas).toHaveAttribute("data-image", "4000x2667", { timeout: 15_000 });
  return canvas;
}

export async function readView(page: Page) {
  const canvas = page.getByTestId("editor-canvas");
  return {
    scale: Number(await canvas.getAttribute("data-view-scale")),
    x: Number(await canvas.getAttribute("data-view-x")),
    y: Number(await canvas.getAttribute("data-view-y")),
  };
}

/** Display coordinates (page pixels) of an image-pixel point. */
export async function displayPoint(page: Page, ix: number, iy: number) {
  const box = await page.getByTestId("editor-canvas").boundingBox();
  if (!box) throw new Error("canvas not laid out");
  const v = await readView(page);
  return { x: box.x + ix * v.scale + v.x, y: box.y + iy * v.scale + v.y };
}

test("loads the image record and boxes, fits the image and zooms with the wheel", async ({ page }) => {
  const boxesRequest = page.waitForRequest((r) => r.method() === "GET" && r.url().endsWith(`/images/${IMG}/boxes`));
  const canvas = await openEditor(page);
  await boxesRequest;
  const fitted = await readView(page);
  expect(fitted.scale).toBeGreaterThan(0.1);
  expect(fitted.scale).toBeLessThan(1);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -240);
  await expect.poll(async () => (await readView(page)).scale).toBeGreaterThan(fitted.scale);
});

test("pans with space-drag", async ({ page }) => {
  const canvas = await openEditor(page);
  const before = await readView(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.keyboard.down(" ");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 230, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up(" ");
  await expect.poll(async () => (await readView(page)).x).toBeCloseTo(before.x + 60, 0);
  expect((await readView(page)).scale).toBe(before.scale);
});

test("drawing on the canvas posts a box in image pixels with the active class", async ({ page }) => {
  await openEditor(page);
  const from = await displayPoint(page, 2000, 1500);
  const to = await displayPoint(page, 2400, 1800);
  const posted = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/images/${IMG}/boxes`));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  const body = (await posted).postDataJSON() as { class_id: string; x: number; y: number; w: number; h: number };
  const { scale } = await readView(page);
  const tolerance = 2 / scale + 1;
  expect(body.class_id).toBe("c1a2b3c4-0000-4000-8000-000000000001");
  expect(Math.abs(body.x - 2000)).toBeLessThan(tolerance);
  expect(Math.abs(body.y - 1500)).toBeLessThan(tolerance);
  expect(Math.abs(body.w - 400)).toBeLessThan(tolerance);
  expect(Math.abs(body.h - 300)).toBeLessThan(tolerance);
});

test("dragging a box patches its position", async ({ page }) => {
  await openEditor(page);
  const centre = await displayPoint(page, 512 + 70, 300 + 45);
  const patched = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().includes("/boxes/b0000000-6666-4000-8000-000000000001"),
  );
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 40, centre.y + 20, { steps: 8 });
  await page.mouse.up();
  const body = (await patched).postDataJSON() as { x: number; y: number; w: number; h: number };
  const { scale } = await readView(page);
  expect(Math.abs(body.x - (512 + 40 / scale))).toBeLessThan(2 / scale + 1);
  expect(Math.abs(body.y - (300 + 20 / scale))).toBeLessThan(2 / scale + 1);
  expect(body.w).toBeCloseTo(140, 0);
  expect(body.h).toBeCloseTo(90, 0);
});
