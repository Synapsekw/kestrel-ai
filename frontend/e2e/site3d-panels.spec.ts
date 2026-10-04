import { expect, test, type Locator, type Page } from "@playwright/test";
import { P } from "./fixtures/assetModels";
import { SWIFTSHADER } from "./fixtures/cloudWorkspace";
import { PLANT, routePlantSite } from "./fixtures/plantSite";

test.use(SWIFTSHADER);

/**
 * What the 3D view draws now, as composited, in the strip of canvas between the Layers panel and the register
 * (the app exposes no render signal of its own, and the panels' own controls change with their switches).
 */
async function shot(page: Page, canvas: Locator, left: Locator, right: Locator) {
  const [c, l, r] = await Promise.all([canvas.boundingBox(), left.boundingBox(), right.boundingBox()]);
  if (!c || !l || !r) throw new Error("the site view is not laid out");
  // 48 px clear of each panel's edge: the panels' drop shadows follow their height.
  const x = l.x + l.width + 48;
  const clip = { x, y: c.y, width: r.x - 48 - x, height: c.height };
  return async () => (await page.screenshot({ animations: "disabled", clip })).toString("base64");
}

test("open a plant in the site view, toggle layers, find a tag, edit its height into a new version", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.emulateMedia({ reducedMotion: "reduce" }); // presets jump, so the frame holds still between shots
  const posted = await routePlantSite(page);

  await page.goto(`/p/${P}/overview`);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: /^Asset models/ })
    .click();
  // Ruling 13: a plant model opens in the site view.
  await expect(page).toHaveURL(new RegExp(`/p/${P}/site/${PLANT}$`), { timeout: 20_000 });

  const layers = page.getByRole("region", { name: "Layers" });
  await expect(layers).toContainText("3 items", { timeout: 20_000 });
  const panel = page.getByRole("complementary", { name: "Plant register" });
  const pixels = await shot(page, page.getByTestId("site-canvas"), layers, panel);
  for (const name of ["Plant model", "Sky"]) {
    const sw = layers.getByRole("switch", { name });
    await expect(sw).toHaveAttribute("aria-checked", "true");
    const shown = await pixels();
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    // The toggle reaches the 3D view: the drawn frame changes, and comes back when the layer does.
    await expect.poll(() => pixels(), { timeout: 10_000 }).not.toBe(shown);
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => pixels(), { timeout: 10_000 }).toBe(shown);
  }
  await expect(layers.getByText("This model has no sea.")).toBeVisible();

  await panel.getByRole("searchbox", { name: "Search the register" }).fill("20-T-0001");
  await expect(panel.getByRole("button", { name: /30-P-0001/ })).toHaveCount(0);
  await panel.getByRole("button", { name: /20-T-0001/ }).click();
  await expect(panel.getByRole("heading", { name: "LNG tank 1" })).toBeVisible();

  await panel.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(panel.getByText("Editing from version 1")).toBeVisible();
  await panel.getByLabel("Top EL").fill("140");
  const glbV2 = page.waitForRequest((r) => r.url().includes(`/asset-models/${PLANT}/versions/2/glb`));
  await panel.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.getByText("Saved version 2")).toBeVisible();
  await glbV2;
  await expect(panel.getByText("Version 2", { exact: true })).toBeVisible();
  await expect(page.getByText(/could not load/i)).toHaveCount(0);

  const sent = posted.versions[0];
  expect(sent.spec.items.find((i) => i.id === "20-T-0001")?.top_el).toBe(140);
  expect(sent.note).toBe("Edited 20-T-0001 from v1: top EL 135 → 140 m");
  expect(pageErrors).toEqual([]);
});
