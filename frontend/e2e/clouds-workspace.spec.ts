import { test, expect, type Page } from "@playwright/test";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";
import { buildOctree, redGreenGrid, routeOctree } from "./fixtures/potreeOctree";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

// WebGL on SwiftShader for WebGL only (vault/decisions/2026-09-26-gotcha-swiftshader-compositing.md).
test.use({ launchOptions: { args: ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"] } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kestrel.diagnostics", "1"));
});

const MAP = "a0000000-6666-4000-8000-000000000009";
/** A ready map linked to the fixture cloud (same CRS), so the readout offers "Show on map". */
const linkedMap = {
  id: MAP,
  name: "Site ortho",
  status: "ready",
  error: null,
  source_path: "D:/orthos/site.tif",
  source_size: 1,
  width: 2000,
  height: 2000,
  band_count: 3,
  dtype: "uint8",
  crs_wkt: 'PROJCRS["WGS 84 / UTM zone 39N"]',
  epsg: 32639,
  proj4: "+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs",
  geotransform: [243500, 0.05, 0, 3178100, 0, -0.05],
  bounds_native: [243500, 3178000, 243600, 3178100],
  bounds_wgs84: [48.3744, 28.7038, 48.3755, 28.7048],
  gsd_cm: 5,
  tile_grid: { tile_size: 256, max_zoom: 3 },
  labels_version: 0,
  job_id: null,
  created_at: "2026-09-24T09:00:00Z",
  captured_on: "2026-05-04",
};

async function openSettled(page: Page, cloud: Record<string, unknown> = {}) {
  // Reduced motion: the panels skip their entrance (reduce-motion:animate-none), so their boxes are
  // final as soon as they render.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson(cloud)] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson(cloud));
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 })),
  );
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await expect
    .poll(async () => page.evaluate(() => window.__kestrelCloudViewer?.stats().settledMs ?? null), {
      timeout: 20_000,
    })
    .not.toBeNull();
}

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("layout: every panel sits at its mockup position and the canvas fills the viewport (spec §15 e2e 1)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openSettled(page);
  const vp = (await page.getByTestId("cloud-centre").boundingBox())!;
  expect(await page.getByTestId("cloud-canvas").boundingBox()).toEqual(vp);
  const box = async (l: ReturnType<Page["getByTestId"]>) => (await l.boundingBox())!;
  const near = (actual: number, expected: number, what: string) =>
    expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(1);
  const right = (b: { x: number; width: number }) => vp.x + vp.width - (b.x + b.width);
  const bottom = (b: { y: number; height: number }) => vp.y + vp.height - (b.y + b.height);

  const pal = await box(page.getByRole("toolbar", { name: "Point cloud tools" }));
  near(pal.x - vp.x, 14, "palette left");
  near(pal.y - vp.y, 14, "palette top");
  const panel = await box(page.getByTestId("cloud-panel"));
  near(panel.x - vp.x, 72, "cloud panel left");
  near(panel.y - vp.y, 14, "cloud panel top");
  near(panel.width, 282, "cloud panel width");
  const insp = await box(page.getByTestId("cloud-inspector"));
  near(right(insp), 14, "inspector right");
  near(insp.y - vp.y, 14, "inspector top");
  near(bottom(insp), 204, "inspector bottom");
  near(insp.width, 330, "inspector width");
  const giz = await box(page.getByTestId("cloud-gizmo"));
  near(giz.x - vp.x, 72, "gizmo left");
  near(bottom(giz), 14, "gizmo bottom");
  const ro = await box(page.getByTestId("cloud-readout"));
  // Centred on the viewport when the row has room (it moves aside only on narrow windows).
  near(ro.x + ro.width / 2, vp.x + vp.width / 2, "readout centre");
  near(bottom(ro), 14, "readout bottom");
  const mini = await box(page.getByTestId("cloud-minimap"));
  near(right(mini), 14, "minimap right");
  near(bottom(mini), 14, "minimap bottom");
  near(mini.width, 330, "minimap width");
  near(mini.height, 178, "minimap height");
  const hint = await box(page.getByTestId("cloud-hintbar"));
  near(hint.y - vp.y, 14, "hint bar top");
  near(hint.x + hint.width / 2, vp.x + vp.width / 2, "hint bar centre");
  // Full-bleed: the project tabs are hidden on the workspace (F §5.2).
  await expect(page.getByRole("tab", { name: /^Point clouds/ })).toHaveCount(0);
});

test("at 1280 x 720 the readout, with a pick and Show on map, stays on one line clear of the gizmo and the minimap", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await jsonRoute(page, `/api/v1/projects/${P}/maps`, { items: [linkedMap] });
  await openSettled(page, { map_id: MAP });
  const canvas = (await page.getByTestId("cloud-canvas").boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  const readout = page.getByTestId("cloud-readout");
  await expect(readout.getByRole("button", { name: "Show on map" })).toBeVisible();
  await expect(readout).not.toContainText("—");
  const ro = (await readout.boundingBox())!;
  const giz = (await page.getByTestId("cloud-gizmo").boundingBox())!;
  const mini = (await page.getByTestId("cloud-minimap").boundingBox())!;
  expect(intersects(ro, giz), `readout ${JSON.stringify(ro)} vs gizmo ${JSON.stringify(giz)}`).toBe(false);
  expect(intersects(ro, mini), `readout ${JSON.stringify(ro)} vs minimap ${JSON.stringify(mini)}`).toBe(
    false,
  );
  // one line is 46 px (py-2 around the 28 px icon button); a wrapped pill is 70 px or more
  expect(ro.height, "one line").toBeLessThanOrEqual(48);
  // and the button takes the click (nothing above it)
  await readout.getByRole("button", { name: "Show on map" }).click({ trial: true });
});

test("tool keys arm tools, the hint bar follows, Esc and Esc again return to Orbit (spec §15 e2e 2)", async ({
  page,
}) => {
  await openSettled(page);
  const toolbar = page.getByRole("toolbar", { name: "Point cloud tools" });
  const hint = page.getByTestId("cloud-hintbar");
  await page.keyboard.press("l");
  await expect(toolbar.getByRole("button", { name: "Distance" })).toHaveAttribute("aria-pressed", "true");
  await expect(hint).toContainText("Click two points to measure a distance");
  await page.keyboard.press("z");
  await expect(toolbar.getByRole("button", { name: "Height" })).toHaveAttribute("aria-pressed", "true");
  await expect(hint).toContainText("Click a base point, then a top point");
  const canvas = (await page.getByTestId("cloud-canvas").boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2); // one pick
  await page.keyboard.press("Escape");
  await expect(toolbar.getByRole("button", { name: "Height" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(toolbar.getByRole("button", { name: "Orbit" })).toHaveAttribute("aria-pressed", "true");
  await expect(hint).toContainText("Drag to orbit");
  await page.keyboard.press("h");
  await expect(toolbar.getByRole("button", { name: "Pan" })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__kestrelCloudViewer!.navMode())).toBe("pan");
  // The arrival view is already from the south (40° oblique), so Top goes first: Alt+1 puts the
  // camera straight above the target, then Alt+2 (Front) must bring it level and south of it.
  const pose = () => page.evaluate(() => window.__kestrelCloudViewer!.cameraPose());
  const shape = (p: Awaited<ReturnType<typeof pose>>) => {
    if (!p) return null;
    const [dx, dy, dz] = [0, 1, 2].map((i) => p.position[i] - p.target[i]);
    const d = Math.hypot(dx, dy, dz);
    return { above: dz / d > 0.99, level: Math.abs(dz) / d < 0.01, south: dy < 0 };
  };
  await page.keyboard.press("Alt+1");
  await expect.poll(async () => shape(await pose())?.above).toBe(true);
  await page.keyboard.press("Alt+2");
  await expect.poll(async () => shape(await pose())).toEqual({ above: false, level: true, south: true });
});
