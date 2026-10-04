import { expect, test } from "@playwright/test";
import { SWIFTSHADER } from "./fixtures/cloudWorkspace";
import { routePlantItems, routeSiteScene, SITE_URL } from "./fixtures/siteScene";

test.use(SWIFTSHADER);

// S1 adds no entry point (plan ruling R12): these open the deep link. S3's entry-point tests reach it
// through the Main-navigation "Asset models" link.

test("open the site view: the plant model loads and a click opens the item", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.emulateMedia({ reducedMotion: "reduce" }); // presets jump, so the click lands on the tank
  await routeSiteScene(page, { withModel: true });
  await routePlantItems(page);
  await page.goto(SITE_URL);
  await expect(page.getByTestId("site-screen")).toBeVisible();
  const layers = page.getByRole("region", { name: "Layers" });
  await expect(layers).toContainText("2 items", { timeout: 20_000 });
  const register = page.getByRole("complementary", { name: "Plant register" });
  await expect(register.getByRole("button", { name: /20-T-0001/ })).toBeVisible();
  await page.getByRole("button", { name: "Plan view" }).click();
  await page.getByTestId("site-canvas").click();
  await expect(register.getByRole("heading", { name: "LNG tank" })).toBeVisible();
  await expect(register).toContainText("20-T-0001");
  await page.keyboard.press("Escape");
  await expect(register.getByRole("heading", { name: "LNG tank" })).toHaveCount(0);
  // The layer toggle (spec section 13; S1 hand-off): the switch turns the model off.
  const model = layers.getByRole("switch", { name: "Plant model" });
  await model.click();
  await expect(model).toHaveAttribute("aria-checked", "false");
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
  await expect(page.getByRole("region", { name: "Layers" })).toContainText("None yet");
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
  await expect(page.getByRole("region", { name: "Layers" })).toBeVisible();
  expect(pageErrors).toEqual([]);
  await ctx.close();
});
