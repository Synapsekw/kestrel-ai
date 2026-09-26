import { test, expect } from "@playwright/test";

const PROJECT = "7f1c2e3a-1111-4000-8000-000000000001";
const IMAGE = "10000000-5555-4000-8000-000000000001";

test("Contour rail expands without losing the workflow or current route", async ({ page }) => {
  await page.goto(`/p/${PROJECT}`);
  await expect(page.getByRole("heading", { name: "Ahmadia", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation");
  const collapsed = await nav.boundingBox();
  expect(collapsed?.width).toBeLessThanOrEqual(96);
  await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Collapse navigation", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await nav.getByRole("link", { name: /^Images/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${PROJECT}/data$`));
  await expect(nav.getByRole("link", { name: /^Images/ })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Collapse navigation", exact: true }).click();
  await expect(nav.getByRole("link", { name: "Project settings", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "App settings", exact: true })).toBeVisible();
});

test("single inspector leaves room for the image and retains drawing classes and shortcuts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`/p/${PROJECT}/edit/${IMAGE}`);
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

test("Home's imagery is bounded and a failed preview does not hide the next action", async ({ page }) => {
  const requests: URL[] = [];
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT}/images`,
    (route) => {
      requests.push(new URL(route.request().url()));
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ detail: "Preview unavailable" }),
      });
    },
  );
  await page.goto(`/p/${PROJECT}`);
  await expect(page.getByRole("heading", { name: "Ahmadia", exact: true })).toBeVisible();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  for (const url of requests) {
    expect(url.searchParams.get("limit")).toBe("3");
    expect(url.searchParams.has("cursor")).toBe(false);
  }
  await expect(page.getByTestId("home-next-step").getByRole("link")).toBeVisible();
});

test("locked-step explanations stay visible outside both rail widths", async ({ page }) => {
  // No dataset and no model trained here: the mock's library holds a model trained in this project,
  // which would mark Train done instead of locked.
  const empty = { items: [], next_cursor: null };
  for (const path of [`/api/v1/projects/${PROJECT}/datasets`, "/api/v1/library/models"]) {
    await page.route(
      (url) => url.pathname === path,
      (route) =>
        route.fulfill({
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify(empty),
        }),
    );
  }
  await page.goto(`/p/${PROJECT}`);
  await expect(page.getByTestId("home-next-step")).toBeVisible();
  const train = page.getByRole("navigation").getByRole("link", { name: /^Train/ });
  await expect(train).toHaveAttribute("aria-disabled", "true");
  await train.focus();
  const explanation = page.getByRole("tooltip");
  await expect(explanation).toHaveText("Create a dataset first");
  await expect(explanation).toBeInViewport({ ratio: 1 });
  await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
  await train.focus();
  await expect(explanation).toBeInViewport({ ratio: 1 });
});
