import { test, expect, type Locator, type Page } from "@playwright/test";
import { evidencePath } from "./evidence";
import {
  P,
  SITE,
  enableDiagnostics,
  serveMapWorkspace,
  sitePixel,
  type MapWorld,
} from "./fixtures/mapWorkspace";

// Spec M §15 flow 2: a DXF placed by its CRS and a PDF placed with three control points; the RMSE
// shows, "Save placement" sends the pairs, and the overlay re-renders at the new georef version.
// Selectors: task-1-inventory.md and ruling R-P5 (the drawing import, the row menu's "Align").

test.beforeEach(async ({ page }) => {
  await enableDiagnostics(page);
});

async function openWorkspace(page: Page): Promise<MapWorld> {
  const world = await serveMapWorkspace(page);
  await page.goto(`/p/${P}/maps`);
  await expect(page.getByTestId("map-workspace")).toBeVisible();
  // R-URL: the settled address, not a transient one.
  await expect(page).toHaveURL(new RegExp(`/p/${P}/maps(\\?|$)`));
  return world;
}

/** Layers "+" → "Import drawing" → file → "Read file" → (DXF) EPSG placement → "Start import". */
async function importDrawing(page: Page, path: string, epsg: string | null) {
  await page.getByRole("button", { name: "Add a layer" }).click();
  await page.getByRole("menuitem", { name: "Import drawing" }).click();
  const dialog = page.getByRole("dialog", { name: "Import drawing" });
  await dialog.getByLabel("Drawing file").fill(path);
  await dialog.getByRole("button", { name: "Read file" }).click();
  if (epsg) {
    await dialog.getByRole("radio", { name: "Coordinates (EPSG)" }).click();
    await dialog.getByLabel("EPSG code").fill(epsg);
  } else {
    // A PDF has a single placement (control points), so the dialog offers no choice.
    await expect(dialog.getByText(/placed with control points once it is imported/)).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Coordinates (EPSG)" })).toHaveCount(0);
  }
  await dialog.getByRole("button", { name: "Start import" }).click();
  await expect(dialog).toBeHidden();
}

/** Imports the unplaced PDF; returns its row and its id. */
async function importPdf(page: Page, world: MapWorld): Promise<{ row: Locator; id: string }> {
  await importDrawing(page, "D:/plans/foundation.pdf", null);
  const row = page.getByTestId("layer-row").filter({ hasText: "foundation" });
  await expect(row).toContainText("not placed");
  return { row, id: String(world.drawings.find((d) => d.format === "pdf")!.id) };
}

/** The row menu's "Align" selects the drawing and arms the tool (a row click selects nothing). */
async function alignFromRowMenu(page: Page, row: Locator, id: string) {
  await row.getByRole("button", { name: /actions$/ }).click();
  await page.getByRole("menuitem", { name: /^Align/ }).click();
  await expect(page.getByTestId("map-inspector")).toHaveAttribute("data-sel", `drawing:${id}`);
  await expect(page.getByRole("button", { name: "Align drawing", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

const PENDING = "Now click the same point on the map.";

test("flow 2: a DXF by CRS, a PDF by three control points, RMSE, save, overlay", async ({ page }) => {
  const world = await openWorkspace(page);

  // DXF with a CRS: placed at build time; its vector tiles are requested.
  const vtiles = page.waitForRequest((r) => /\/drawings\/[^/]+\/vtiles\//.test(r.url()));
  await importDrawing(page, "D:/plans/site-plan.dxf", "32633");
  const post = world.calls.find((c) => c.method === "POST" && c.path === "/drawings")!;
  expect(post.body).toMatchObject({ placement: { method: "crs", crs: "EPSG:32633" } });
  const dxfRow = page.getByTestId("layer-row").filter({ hasText: "site-plan" });
  await expect(dxfRow).toBeVisible();
  await expect(dxfRow).not.toContainText("not placed");
  await vtiles;

  // PDF with no placement: "not placed"; K stays off until a drawing is chosen.
  const pdf = await importPdf(page, world);
  await expect(page.getByRole("button", { name: "Align drawing — Choose a drawing first" })).toBeDisabled();
  await alignFromRowMenu(page, pdf.row, pdf.id);
  // Product finding (task-8-report.md F1, pinned by the test.fail below): the session the menu's
  // "Align" starts is dropped at once in the dev build, so K is re-armed (H, then K) to start it.
  await page.keyboard.press("h");
  await page.keyboard.press("k");
  const inspector = page.getByTestId("map-inspector");
  await expect(inspector.getByRole("button", { name: "Save placement" })).toBeDisabled();

  // Three pairs: a click on the drawing (provisional, centred at 60% of the viewport), then the map.
  // The map points sit close to the drawing points, so each refit keeps the next drawing point on it.
  const stage = (await page.getByTestId("site-map").boundingBox())!;
  const at = (fx: number, fy: number) => ({
    x: stage.x + stage.width * fx,
    y: stage.y + stage.height * fy,
  });
  const pairs: [number, number, number, number][] = [
    [0.4, 0.4, 0.38, 0.41],
    [0.6, 0.4, 0.62, 0.39],
    [0.5, 0.6, 0.51, 0.63],
  ];
  const table = page.getByRole("table", { name: "Control points" });
  for (const [i, [sx, sy, dx, dy]] of pairs.entries()) {
    const s = at(sx, sy);
    await page.mouse.click(s.x, s.y);
    await expect(inspector.getByText(PENDING)).toBeVisible();
    const d = at(dx, dy);
    await page.mouse.click(d.x, d.y);
    await expect(table.getByRole("row")).toHaveCount(i + 2); // header + the pairs so far
  }
  await expect(page.getByTestId("georef-rmse")).toContainText(/\d/);
  await page.screenshot({ path: evidencePath("maps", "flow2-align.png") });

  // Save: PUT georef with the three pairs; the raster overlay re-tiles at the new layer version
  // (georef_version 1). Preview tiles during the align carry `t=` at v=0, so they cannot match.
  const retile = page.waitForRequest((r) => {
    const u = new URL(r.url());
    return (
      u.pathname.includes(`/site-tiles/drawing_raster/${pdf.id}/`) &&
      u.searchParams.get("v") === "1" &&
      !u.searchParams.has("t")
    );
  });
  await inspector.getByRole("button", { name: "Save placement" }).click();
  const isPut = (c: MapWorld["calls"][number]) =>
    c.method === "PUT" && c.path === `/drawings/${pdf.id}/georef`;
  await expect.poll(() => world.calls.some(isPut)).toBe(true);
  const put = world.calls.find(isPut)!.body as {
    points: { src: number[]; dst: number[] }[];
    dst_frame?: string;
  };
  expect(put.points).toHaveLength(3);
  expect(put.dst_frame).toBe("site");
  await retile;
  await expect(pdf.row).not.toContainText("not placed");
});

// F1 (task-8-report.md): after the row menu's "Align" the K tool is pressed, but the inspector still
// offers "Align · K" and a click on the drawing starts no pair. Likely cause: under React StrictMode
// DrawingInspector's unmount cleanup (`endFor(id)`) runs after AlignOverlay's `begin`, and the
// overlay's `startedFor` ref then keeps it from starting again. Remove test.fail() once fixed.
test("the row menu's Align starts the align session straight away", async ({ page }) => {
  test.fail();
  const world = await openWorkspace(page);
  const pdf = await importPdf(page, world);
  await alignFromRowMenu(page, pdf.row, pdf.id);
  const inspector = page.getByTestId("map-inspector");
  await expect(inspector.getByRole("button", { name: "Save placement" })).toBeVisible();
  const stage = (await page.getByTestId("site-map").boundingBox())!;
  await page.mouse.click(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5);
  await expect(inspector.getByText(PENDING)).toBeVisible();
});

// R-HX: DXF linework carries the drawing's Selection (drawingTiles.ts vtileFeatures), and W1's
// Select tool picks it within 4 px (view/sketch.ts pickSelection), so a click on a line selects it.
test("a click on a DXF's linework selects the drawing", async ({ page }) => {
  const world = await openWorkspace(page);
  const vtiles = page.waitForRequest((r) => /\/drawings\/[^/]+\/vtiles\//.test(r.url()));
  await importDrawing(page, "D:/plans/site-plan.dxf", "32633");
  await vtiles;
  const dxf = world.drawings.find((d) => d.format === "dxf")!;
  await expect(page.getByTestId("layer-row").filter({ hasText: "site-plan" })).toBeVisible();
  // The import itself selects nothing, so only the click below can select the drawing.
  const selected = `[data-testid="map-inspector"][data-sel="drawing:${dxf.id}"]`;
  await expect(page.locator(selected)).toHaveCount(0);

  // The fake's linework runs along the site box inset by 10 m: its south edge crosses E = cE.
  const onLine = await sitePixel(page, SITE.cE, SITE.minN + 10);
  await expect
    .poll(
      async () => {
        // Retried: the first click can land before the vector tile under it has loaded.
        await page.mouse.click(onLine.x, onLine.y);
        const inspector = page.getByTestId("map-inspector");
        return (await inspector.count()) ? inspector.getAttribute("data-sel") : null;
      },
      { timeout: 10_000 },
    )
    .toBe(`drawing:${dxf.id}`);
});
