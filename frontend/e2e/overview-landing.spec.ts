import { test, expect } from "@playwright/test";
import { entrancesDone, evidencePath } from "./evidence";
import { jsonReply } from "./mock";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

for (const size of [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
]) {
  test(`the Overview fills the content area at ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto(`/p/${P}/overview`);
    const grid = page.getByTestId("overview-grid");
    await expect(grid.locator('[data-pane="hero"]')).toBeVisible();
    await entrancesDone(page);
    const gridBox = (await grid.boundingBox())!;
    const mainBox = (await page.locator("main").boundingBox())!;
    // full width (no 1400px cap) and down to main's bottom padding
    expect(gridBox.width).toBeGreaterThan(mainBox.width - 64);
    // down to main's bottom padding, and not past it (an overflowing grid fails too)
    const gap = mainBox.y + mainBox.height - (gridBox.y + gridBox.height);
    expect(gap).toBeLessThanOrEqual(24);
    expect(gap).toBeGreaterThanOrEqual(-1);
    await page.screenshot({ path: evidencePath("overview-landing", `overview-${size.width}.png`) });
  });
}

test("a short laptop window scrolls instead of crushing the panes", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 600 });
  await page.goto(`/p/${P}/overview`);
  const hero = page.getByTestId("overview-grid").locator('[data-pane="hero"]');
  await expect(hero).toBeVisible();
  expect((await hero.boundingBox())!.height).toBeGreaterThanOrEqual(340);
  const scrolls = await page.locator("main").evaluate((m) => m.scrollHeight > m.clientHeight);
  expect(scrolls).toBe(true);
});

test("an empty project shows the first-data screen and no grid panes", async ({ page }) => {
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/overview`,
    (route) =>
      route.fulfill(
        jsonReply({
          findings: {
            by_status: { open: 0, reviewed: 0, closed: 0 },
            open_by_severity: {},
            open_no_severity: 0,
            by_type: [],
            trend: [],
          },
          data: { image_sets: 0, images: 0, maps: 0, elevations: 0, point_clouds: 0, drawings: 0 },
          latest_volume: null,
          hero_map_id: null,
          hero: null,
          banners: [],
        }),
      ),
  );
  await page.goto(`/p/${P}/overview`);
  await expect(page.getByRole("heading", { name: "Add the first survey" })).toBeVisible();
  await expect(page.locator("[data-pane]")).toHaveCount(1);
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("overview-landing", "first-data.png") });
});
