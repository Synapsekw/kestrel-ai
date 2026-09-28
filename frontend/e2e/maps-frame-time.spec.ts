import { readFileSync, writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { entrancesDone, evidencePath } from "./evidence";
import { measureFrames, pageEnvironment, type FrameStats } from "./frameTime";
import { AUG, P, SEP, enableDiagnostics, serveMapWorkspace } from "./fixtures/mapWorkspace";

// Spec M §13 "Frame budget" and §15 flow 7: pan and zoom in Swipe with 4 layers visible (two orthos,
// the right DSM's hillshade, a drawing), and divider drags. Budget p95 ≤ 20 ms at effects Full,
// asserted only with E2E_FRAME_BUDGET=1 (the evidence run on a quiet machine; Foundation's ruling
// on its Task 5). The gate asserts a real sample: a headless run under parallel load measures the
// machine, not the app.

const EFFECTS_KEY = "kestrel.effects";

async function full(page: Page) {
  await page.addInitScript((key) => {
    try {
      localStorage.setItem(key, "full");
    } catch {
      // Auto
    }
  }, EFFECTS_KEY);
}

const divider = (page: Page) => page.getByRole("slider", { name: "Swipe divider" });

/** Drives the mouse for about `ms`: drags (pan), wheel steps (zoom), or divider drags. */
async function drive(page: Page, what: "pan-zoom" | "divider", ms = 2400) {
  const stage = (await page.getByTestId("site-map").boundingBox())!;
  const cx = stage.x + stage.width / 2;
  const cy = stage.y + stage.height / 2;
  const t0 = Date.now();
  let dir = 1;
  if (what === "divider") {
    const d = (await divider(page).boundingBox())!;
    await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
    await page.mouse.down();
    while (Date.now() - t0 < ms) {
      await page.mouse.move(cx + dir * stage.width * 0.3, cy, { steps: 20 });
      dir = -dir;
    }
    await page.mouse.up();
    return;
  }
  while (Date.now() - t0 < ms) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dir * 160, cy + dir * 90, { steps: 16 });
    await page.mouse.up();
    await page.mouse.wheel(0, dir * 240);
    dir = -dir;
  }
}

test("flow 7: frame time in Swipe with 4 layers, while panning, zooming and dragging the divider", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await full(page);
  await enableDiagnostics(page);
  const world = await serveMapWorkspace(page);
  world.drawings.push({
    id: "d0000000-9999-4000-8000-0000000000fd",
    name: "Site plan",
    format: "dxf",
    status: "ready",
    error: null,
    georef: {
      method: "crs",
      epsg: 32633,
      points: [],
      rmse_m: null,
      residuals_m: [],
      warnings: [],
    },
    georef_version: 1,
    layers: [
      {
        name: "SITE",
        colour: "#22d3ee",
        entity_count: 120,
        visible_default: true,
      },
    ],
    layer_state: {},
    captured_on: null,
  });
  await page.goto(`/p/${P}/maps?l=${AUG}&r=${SEP}&mode=swipe`);
  await expect(divider(page)).toBeVisible();
  // Four visible layers: two orthos, the DSM hillshade, the drawing. Surface rows start hidden
  // (R-DSM), so the Sep DSM is switched on first.
  for (const kind of ["map", "surface", "drawing"]) {
    await expect(page.locator(`[data-testid="layer-row"][data-kind="${kind}"]`).first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Show DSM 14 Sep" }).click();
  await expect(page.getByRole("button", { name: "Hide DSM 14 Sep" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Hide Site plan" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => world.tiles.some((t) => t.startsWith("surface/"))).toBe(true);
  await entrancesDone(page);
  expect(await page.locator("html").getAttribute("data-effects")).toBe("full");
  const env = await pageEnvironment(page);

  const surfaces: Record<string, FrameStats & { what: string }> = {};
  const record = (name: string, what: string, stats: FrameStats) => {
    surfaces[name] = { what, ...stats };
    test.info().annotations.push({
      type: `frame-time ${name}`,
      description: `${stats.samples} frames, p50 ${stats.p50} ms, p95 ${stats.p95} ms, max ${stats.max} ms`,
    });
    expect(stats.samples, name).toBeGreaterThanOrEqual(60);
    if (process.env.E2E_FRAME_BUDGET === "1") expect(stats.p95, `${name} p95 (ms)`).toBeLessThanOrEqual(20);
  };

  // Pan and zoom in Swipe (both sides' tiles, the hillshade and the vector drawing move together).
  await page.getByTestId("site-map").focus();
  await page.keyboard.press("h");
  let sampling = measureFrames(page);
  await drive(page, "pan-zoom");
  record("swipe-pan-zoom", "Swipe, 4 layers, drag-pan + wheel zoom continuously", await sampling);

  // Divider drags (the clip re-renders every frame).
  sampling = measureFrames(page);
  await drive(page, "divider");
  record("swipe-divider", "Swipe, 4 layers, divider dragged side to side continuously", await sampling);

  expect(world.tiles.some((t) => t.startsWith("map/"))).toBe(true);
  expect(world.tiles.some((t) => t.startsWith("surface/"))).toBe(true);

  const run = {
    at: new Date().toISOString(),
    budget: process.env.E2E_FRAME_BUDGET === "1",
    ...env,
    surfaces,
  };
  const path = evidencePath("maps", "frame-time.json");
  let runs: unknown[] = [];
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") {
    try {
      runs = (JSON.parse(readFileSync(path, "utf8")) as { runs: unknown[] }).runs;
    } catch {
      runs = [];
    }
  }
  writeFileSync(path, `${JSON.stringify({ runs: [...runs, run] }, null, 2)}\n`);
});
