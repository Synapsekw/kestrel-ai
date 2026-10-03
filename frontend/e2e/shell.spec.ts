import { test, expect, type Page } from "@playwright/test";
import { fromMock } from "./mock";

// The contract's examples, which the Prism mock serves for every id.
const P = "7f1c2e3a-1111-4000-8000-000000000001";
const IMG = "10000000-5555-4000-8000-000000000001";
const MAP = "a0000000-6666-4000-8000-000000000001";

/** Waits for the page entrance to finish (ADR 2026-09-21-gotcha-measuring-animated-drawers). */
async function settled(page: Page) {
  const opacity = await page
    .locator("[data-transition-key]")
    .evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)).then(() => getComputedStyle(el).opacity),
    );
  expect(opacity).toBe("1");
}

test("the rail reaches every section and marks the current one", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/projects$/);
  const rail = page.getByRole("navigation", { name: "Main navigation" });
  await expect(rail.getByRole("link", { name: "Projects", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await rail.getByRole("link", { name: "Models", exact: true }).click();
  await expect(page).toHaveURL(/\/models\/library$/);
  await expect(rail.getByRole("link", { name: "Models", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await rail.getByRole("link", { name: "Catalogue", exact: true }).click();
  await expect(page).toHaveURL(/\/catalogue$/);
  await rail.getByRole("link", { name: "Jobs", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs$/);
  await rail.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "App settings" })).toBeVisible();
  const box = await rail.boundingBox();
  expect(box?.width).toBe(64);
  // "?" outside a text field opens the shortcut sheet.
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
});

test("a project opens on Overview; the tabs switch pages and the entrance finishes", async ({ page }) => {
  const overview = await fromMock<{ data: { images: number } }>(page, `/api/v1/projects/${P}/overview`);
  await page.goto(`/p/${P}`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/overview$`));
  const tabs = page.getByRole("tablist");
  await expect(tabs.getByRole("tab")).toHaveCount(9);
  await expect(tabs.getByRole("tab", { name: /^Drawings/ })).toHaveAttribute("href", `/p/${P}/drawings`);
  await expect(tabs.getByRole("tab", { name: /^Images/ })).toContainText(
    new RegExp(String(overview.data.images).replace(/\B(?=(\d{3})+(?!\d))/g, ",?")),
  );
  await tabs.getByRole("tab", { name: /^Images/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images(/[^/?]+)?$`));
  await expect(tabs.getByRole("tab", { name: /^Images/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("banner")).toContainText("Images");
  await settled(page);
});

test("Ctrl K goes to a tab and finds a finding or a data item", async ({ page }) => {
  const results = await fromMock<{ findings: { number: number }[]; data: { label: string }[] }>(
    page,
    `/api/v1/projects/${P}/search?q=cr&limit=8`,
  );
  await page.goto(`/p/${P}/images`);
  // The workspace's sr-only <h1>; the browser pane has its own "Images" <h2>.
  await expect(page.getByRole("heading", { name: "Images", exact: true, level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  const input = page.getByRole("combobox", { name: "Command" });
  // The heading paints a few ms before React attaches the window listeners (passive effects run
  // after paint), so the first chord is retried until the palette has focus.
  await expect(async () => {
    await page.keyboard.press("Control+K");
    await expect(input).toBeFocused({ timeout: 500 });
  }).toPass();
  await input.fill("Measurements");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/p/${P}/measurements$`));

  await page.keyboard.press("Control+K");
  await page.getByRole("combobox", { name: "Command" }).fill("cr");
  const expected = results.findings[0]
    ? `F-${String(results.findings[0].number).padStart(4, "0")}`
    : results.data[0].label;
  await expect(page.getByRole("option", { name: new RegExp(expected) })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox", { name: "Command" })).toHaveCount(0);
});

test("old addresses land on the new tabs", async ({ page }) => {
  await page.goto(`/p/${P}/data`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images(/[^/?]+)?$`));
  await page.goto(`/p/${P}/edit/${IMG}`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images/${IMG}$`));
  // A bare workspace under the tabs fills the window and never pushes the shell past it.
  await expect(page.getByTestId("image-canvas")).toHaveAttribute("data-image", /x/);
  const rail = await page.getByRole("navigation", { name: "Main navigation" }).boundingBox();
  expect(rail?.height).toBe(page.viewportSize()?.height);
  await page.goto(`/p/${P}/volumes`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/measurements/volumes$`));
  await page.goto("/library?model=m1");
  await expect(page).toHaveURL(/\/models\/library\?model=m1$/);
  await page.goto("/no/such/page");
  await expect(page.getByText("Nothing at this address")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
});

test("the map viewer is full-bleed: no tabs, and the breadcrumb names the tab", async ({ page }) => {
  // The map detail left in the tab is the evaluation screen; `maps/:mapId` now redirects to the workspace.
  await page.goto(`/p/${P}/maps/${MAP}/evaluate`);
  await expect(page.getByRole("banner")).toContainText("Maps");
  await expect(page.getByRole("tablist")).toHaveCount(0);
});

test("the Maps tab is the full-bleed map workspace", async ({ page }) => {
  await page.goto(`/p/${P}/maps`);
  await expect(page.getByRole("toolbar", { name: "Map" })).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("Maps");
  await expect(page.getByRole("tablist")).toHaveCount(0);
});

test("secondary pages open from More", async ({ page }) => {
  await page.goto(`/p/${P}/overview`);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Analytics" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/analytics$`));
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
});

test("the palette field's Ctrl K key caps sit on one line", async ({ page }) => {
  await page.goto(`/p/${P}/overview`);
  const field = page.getByRole("button", { name: "Search and commands" });
  await expect(field).toBeVisible();
  const caps = field.locator("kbd");
  await expect(caps.first()).toBeVisible();
  const boxes = await caps.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  for (const box of boxes) {
    expect(box.height).toBeLessThanOrEqual(18);
    expect(box.top).toBe(boxes[0].top);
  }
  const wrapper = await caps.first().evaluate((el) => el.parentElement!.getBoundingClientRect().height);
  expect(wrapper).toBeLessThanOrEqual(18);
});
