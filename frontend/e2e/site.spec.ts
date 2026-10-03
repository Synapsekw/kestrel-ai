import { expect, test } from "@playwright/test";
import { SWIFTSHADER } from "./fixtures/cloudWorkspace";
import { routeSiteScene, SITE_URL } from "./fixtures/siteScene";

test.use(SWIFTSHADER);

// S1 adds no entry point (plan ruling R12): these open the deep link. S3's entry-point tests reach it
// through the Main-navigation "Asset models" link.

test("open the site view: the plant model loads and a click selects an item", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.emulateMedia({ reducedMotion: "reduce" }); // presets jump, so the click lands on the tank
  await routeSiteScene(page, { withModel: true });
  await page.goto(SITE_URL);
  await expect(page.getByTestId("site-screen")).toBeVisible();
  const layers = page.getByTestId("site-layers");
  await expect(layers).toContainText("2 items", { timeout: 20_000 });
  await page.getByRole("button", { name: "Plan view" }).click();
  await page.getByTestId("site-canvas").click();
  const card = page.getByTestId("site-selection");
  await expect(card).toContainText("LNG tank");
  await expect(card).toContainText("20-T-0001");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("no plant model yet: the site opens with an empty state that leads to Asset models", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await routeSiteScene(page, { withModel: false });
  await page.goto(SITE_URL);
  await expect(page.getByText("No plant model yet")).toBeVisible();
  await expect(page.getByTestId("site-layers")).toContainText("None yet");
  await page.getByRole("link", { name: "Build a plant model" }).click();
  await expect(page).toHaveURL(/\/models$/);
  expect(pageErrors).toEqual([]);
});

test("no WebGL: a notice and the layers list, never an uncaught error", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await routeSiteScene(page, { withModel: true });
  await page.goto(SITE_URL);
  await expect(page.getByRole("alert")).toContainText(/3D view is off/i);
  await expect(page.getByTestId("site-layers")).toBeVisible();
  expect(pageErrors).toEqual([]);
  await ctx.close();
});
