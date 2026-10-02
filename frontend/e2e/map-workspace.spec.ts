import { test, expect } from "@playwright/test";
import { fromMock, jsonReply } from "./mock";

// The contract's example ids, which the Prism mock serves for every id.
const P = "7f1c2e3a-1111-4000-8000-000000000001";
const MAP = "a0000000-6666-4000-8000-000000000001";
const FID = "f0000000-1212-4000-8000-000000000217";
const API = `/api/v1/projects/${P}`;

// M-C0's examples: a UTM 38N frame, surveys 2026-08-14 and 2026-09-14 flown plus 2026-10-14 planned,
// and three layers (September ortho, August DSM, an unplaced PDF).

test("the workspace opens over the Prism mock with its chrome", async ({ page }) => {
  await page.goto(`/p/${P}/maps`);
  await expect(page.getByRole("toolbar", { name: "Map" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Findings" })).toBeVisible();
  await expect(page.getByRole("button", { name: /EPSG:32638/ })).toBeVisible();
  await expect(page).toHaveURL(/r=2026-09-14/);
});

test("tools and survey dates follow the keyboard", async ({ page }) => {
  await page.goto(`/p/${P}/maps`);
  await expect(page.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("h");
  await expect(page.getByRole("button", { name: "Pan" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status").filter({ hasText: "Pan" })).toBeVisible();
  await page.keyboard.press("[");
  await expect(page).toHaveURL(/r=2026-08-14/);
  await page.keyboard.press("]");
  await page.keyboard.press("]"); // the planned 2026-10-14 is skipped
  await expect(page).toHaveURL(/r=2026-09-14/);
  await page.keyboard.press("c");
  await expect(page).toHaveURL(/mode=swipe/);
});

test("an empty project teaches the first import", async ({ page }) => {
  const layers = await fromMock<{ frame: unknown }>(page, `${API}/map-workspace/layers`);
  await page.route(
    (u) => u.pathname === `${API}/map-workspace/layers`,
    (r) => r.fulfill(jsonReply({ frame: layers.frame, items: [] })),
  );
  await page.goto(`/p/${P}/maps`);
  await expect(page.getByText("No georeferenced data yet")).toBeVisible();
});

test("a map finding link opens the finding and drops the link params (spec §5, §9.4)", async ({ page }) => {
  const finding = await fromMock<Record<string, unknown>>(page, `${API}/findings/${FID}`);
  await page.route(
    (u) => u.pathname === `${API}/findings/${FID}`,
    (r) =>
      r.fulfill(
        jsonReply({
          ...finding,
          anchor: {
            kind: "map",
            map_id: MAP,
            geometry: { type: "Point", coordinates: [583120.4, 3265410.2] },
          },
          lon: 47.765,
          lat: 29.495,
        }),
      ),
  );
  await page.goto(`/p/${P}/maps?map=${MAP}&finding=${FID}`);
  await expect(page).toHaveURL(new RegExp(`sel=finding%3A${FID}`));
  await expect(page).not.toHaveURL(/[?&]finding=/);
  await expect(page.getByRole("complementary", { name: "Finding" })).toBeVisible();
});
