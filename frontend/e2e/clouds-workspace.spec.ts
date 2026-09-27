import { test, expect, type Page } from "@playwright/test";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";
import { buildOctree, redGreenGrid, routeOctree } from "./fixtures/potreeOctree";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

// WebGL on SwiftShader for WebGL only (vault/decisions/2026-09-26-gotcha-swiftshader-compositing.md).
test.use({ launchOptions: { args: ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"] } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kestrel.diagnostics", "1"));
});

async function openSettled(page: Page) {
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson()] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
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
  await page.waitForTimeout(600); // the panels' entrance (≤ 400 ms) has finished
}

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
  // Centred in the band between the gizmo (72 + 64) and the minimap (14 + 330), not the full width.
  near(ro.x + ro.width / 2, vp.x + (150 + vp.width - 358) / 2, "readout centre");
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

  // At the default 1280 × 720 the readout (and its "Show on map") never runs under the minimap.
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect
    .poll(async () => {
      const r = await box(page.getByTestId("cloud-readout"));
      const m = await box(page.getByTestId("cloud-minimap"));
      const apart =
        r.x + r.width <= m.x || m.x + m.width <= r.x || r.y + r.height <= m.y || m.y + m.height <= r.y;
      return apart;
    })
    .toBe(true);
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
  // Alt+2 is the Front view: after the 350 ms tween the camera is south of its target.
  await page.keyboard.press("Alt+2");
  await expect
    .poll(async () => {
      const pose = await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose());
      return pose ? pose.position[1] < pose.target[1] : false;
    })
    .toBe(true);
});
