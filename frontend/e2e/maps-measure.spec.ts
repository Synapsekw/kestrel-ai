import { test, expect, type Page } from "@playwright/test";
import { evidencePath } from "./evidence";
import { P, SITE, clickSite, enableDiagnostics, serveMapWorkspace } from "./fixtures/mapWorkspace";

// Spec M §15 flows 3 and 6. The numbers are the server's (the fake's `results`); the client may
// only show its "≈ grid" label while drawing (spec M13). Selectors: task-1-inventory.md and ruling
// R-P5 (the primary figure is the inspector's "Length" / "Area" region; the zone is checked in the
// inspector and in `world.siteAreas`, never as canvas text).

test.beforeEach(async ({ page }) => {
  await enableDiagnostics(page);
});

/**
 * Presses a tool key until its palette button reads pressed. A key pressed in the first moments
 * after the workspace appears is not always bound yet (a single press can be lost); a re-press
 * keeps the tool active (toolStore has no toggle), so repeating is harmless.
 */
async function arm(page: Page, key: string, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  await expect(async () => {
    await page.keyboard.press(key);
    await expect(button).toHaveAttribute("aria-pressed", "true", { timeout: 500 });
  }).toPass();
}

/**
 * `drawSite` at a human pace: OpenLayers turns any second click within 250 ms into a `dblclick`,
 * wherever it lands, and a double-click finishes the draft. Back-to-back `clickSite` calls come
 * ~60 ms apart, so `drawSite` ends a three-vertex line after two. 300 ms between vertices is a
 * quick hand, not a double-click.
 */
async function draw(page: Page, key: string, name: string, pts: [number, number][]) {
  await arm(page, key, name);
  for (const [i, [e, n]] of pts.entries()) {
    if (i > 0) await page.waitForTimeout(300);
    await clickSite(page, e, n);
  }
  await page.keyboard.press("Enter");
}

const posts = (world: { calls: { method: string; path: string; body: unknown }[] }) =>
  world.calls.filter((c) => c.method === "POST" && c.path === "/map-measurements");

test("flow 3: distance, area and a profile are stored by the server and listed with the others", async ({
  page,
}) => {
  const world = await serveMapWorkspace(page);
  await page.goto(`/p/${P}/maps`);
  await expect(page.getByTestId("map-workspace")).toBeVisible();
  // R-URL: the settled address, not a transient one.
  await expect(page).toHaveURL(new RegExp(`/p/${P}/maps(\\?|$)`));
  const inspector = page.getByTestId("map-inspector");

  // Distance: 30 m east then 40 m south = 70 m grid; the fake's ellipsoidal value is ×1.0004.
  await draw(page, "l", "Measure distance", [
    [SITE.cE - 30, SITE.cN + 20],
    [SITE.cE, SITE.cN + 20],
    [SITE.cE, SITE.cN - 20],
  ]);
  await expect(inspector).toHaveAttribute("data-sel", /^measurement:/);
  await expect(inspector.getByRole("region", { name: "Length" })).toContainText(/70\.0\d m/);
  await expect.poll(() => posts(world).length).toBe(1);
  expect(posts(world)[0].body).toMatchObject({ kind: "distance" });
  expect((posts(world)[0].body as { vertices: number[][] }).vertices).toHaveLength(3);

  // Area: a 20 × 10 m rectangle = 200 m² grid (×1.0008 on the ellipsoid).
  await draw(page, "q", "Measure area", [
    [SITE.cE - 10, SITE.cN + 5],
    [SITE.cE + 10, SITE.cN + 5],
    [SITE.cE + 10, SITE.cN - 5],
    [SITE.cE - 10, SITE.cN - 5],
  ]);
  await expect(inspector.getByRole("region", { name: "Area" })).toContainText(/200\.\d m²/);
  expect((posts(world)[1].body as { vertices: number[][] }).vertices).toHaveLength(4);

  // Profile across the pit: a chart in the inspector. Surface rows are hidden by default (R-DSM);
  // the profile still picks the first elevation layer, so no toggle is needed here.
  await draw(page, "e", "Elevation profile", [
    [SITE.cE - 40, SITE.cN],
    [SITE.cE + 40, SITE.cN],
  ]);
  await expect(inspector.getByRole("img", { name: "Elevation profile" })).toBeVisible();
  await page.screenshot({ path: evidencePath("maps", "flow3-profile.png") });
  expect(posts(world).map((c) => (c.body as { kind: string }).kind)).toEqual(["distance", "area", "profile"]);
  const profile = posts(world)[2].body as { surface_ids?: string[] };
  expect(profile.surface_ids?.length ?? 0).toBeGreaterThan(0);

  // The union (M owns GET /measurements; W6's tab lists it).
  await page.goto(`/p/${P}/measurements`);
  const grid = page.getByRole("grid", { name: "Measurements" });
  await expect(grid).toBeVisible();
  expect(world.measurements).toHaveLength(3);
  for (const mm of world.measurements) await expect(grid).toContainText(String(mm.name));
});

test("flow 6: the zone tool saves a site area with its category", async ({ page }) => {
  const world = await serveMapWorkspace(page);
  await page.goto(`/p/${P}/maps?tool=zone`);
  await expect(page.getByTestId("map-workspace")).toBeVisible();
  const zone = page.getByRole("button", { name: "Zone", exact: true });
  await expect(zone).toHaveAttribute("aria-pressed", "true");
  // R-URL: once settled, the arrival's `tool` is gone from the address.
  await expect(page).toHaveURL(new RegExp(`/p/${P}/maps(\\?|$)`));
  await expect(page).not.toHaveURL(/tool=/);

  // Re-pressing a tool key keeps it active (toolStore, no toggle), so `draw`'s "z" is safe.
  await draw(page, "z", "Zone", [
    [SITE.cE - 20, SITE.cN + 20],
    [SITE.cE + 20, SITE.cN + 20],
    [SITE.cE + 20, SITE.cN - 20],
    [SITE.cE - 20, SITE.cN - 20],
  ]);
  await expect(zone).toHaveAttribute("aria-pressed", "true");
  const pop = page.getByRole("dialog", { name: "New zone" });
  await pop.getByLabel("Name").fill("Crane exclusion");
  await pop.getByLabel("Category").selectOption({ label: "Exclusion" });
  await pop.getByRole("button", { name: "Save zone" }).click();
  await expect(pop).toBeHidden();

  await expect.poll(() => world.siteAreas.length).toBe(1);
  const area = world.siteAreas[0] as {
    id: string;
    name: string;
    category: string;
    polygon_wgs84: number[][];
  };
  expect(area).toMatchObject({ name: "Crane exclusion", category: "exclusion" });
  expect(area.polygon_wgs84.length).toBeGreaterThanOrEqual(4);

  // The saved zone is selected; the inspector shows its name and category. (The caps map label
  // "CRANE EXCLUSION" is drawn on the canvas, so it is not asserted here — R-P5.)
  const inspector = page.getByTestId("map-inspector");
  await expect(inspector).toHaveAttribute("data-sel", `zone:${area.id}`);
  await expect(inspector.getByRole("region", { name: "Name" }).getByRole("textbox")).toHaveValue(
    "Crane exclusion",
  );
  await expect(inspector.getByRole("combobox", { name: "Category" })).toHaveValue("exclusion");
  await expect(inspector.getByRole("combobox", { name: "Category" }).locator("option:checked")).toHaveText(
    "Exclusion",
  );
});
