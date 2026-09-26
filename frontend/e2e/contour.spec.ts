import { test, expect } from "@playwright/test";

const PROJECT = "7f1c2e3a-1111-4000-8000-000000000001";
const IMAGE = "10000000-5555-4000-8000-000000000001";

test("single inspector leaves room for the image and retains drawing classes and shortcuts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`/p/${PROJECT}/images/${IMAGE}`);
  const canvas = page.getByTestId("editor-canvas");
  await expect(canvas).toHaveAttribute("data-image", "4000x2667", { timeout: 15_000 });
  const inspector = page.getByRole("region", { name: "Image inspector", exact: true });
  await expect(inspector).toBeVisible();
  const bounds = await canvas.boundingBox();
  expect(bounds?.width).toBeGreaterThan(550);
  expect(bounds?.height).toBeGreaterThan(400);
  const drawingClass = inspector.getByLabel("Drawing class", { exact: true });
  await drawingClass.selectOption("c1a2b3c4-0000-4000-8000-000000000004");
  await expect(drawingClass).toHaveValue("c1a2b3c4-0000-4000-8000-000000000004");
  await inspector.getByRole("button", { name: "All classes", exact: true }).click();
  await expect(inspector.getByRole("button", { name: /dump_truck/ })).toHaveAttribute("aria-pressed", "true");
  await page.locator("body").click({ position: { x: 88, y: 5 } });
  await page.keyboard.press("1");
  await expect(drawingClass).toHaveValue("c1a2b3c4-0000-4000-8000-000000000001");
  await expect(inspector.getByRole("list", { name: "Regions", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click();
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
  const shortcutBounds = await shortcuts.boundingBox();
  expect(shortcutBounds?.x).toBeGreaterThanOrEqual(bounds!.x);
  expect(shortcutBounds!.x + shortcutBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  await expect(shortcuts.locator("dt").first()).toBeInViewport({ ratio: 1 });
});
