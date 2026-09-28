// frontend/e2e/clouds-engine.spec.ts
import { test, expect, type Page } from "@playwright/test";
import { emptyCameras, routeCameras } from "./fixtures/cameras";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";
import { buildOctree, redGreenGrid, routeOctree } from "./fixtures/potreeOctree";
import { SWIFTSHADER_ARGS, edlOn, viewerSettled } from "./fixtures/viewer";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

test.use({ launchOptions: { args: SWIFTSHADER_ARGS } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kestrel.diagnostics", "1"));
});

async function openGrid(page: Page) {
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson()] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  // Empty (C-L1): the frame-times idle check below is exact, and the Prism mock's example
  // `CloudCameraSet` otherwise lands a stray glyph render inside that window.
  await routeCameras(page, P, emptyCameras());
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 })),
  );
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);
}

const pose = (page: Page) => page.evaluate(() => window.__kestrelCloudViewer!.cameraPose()!);

async function dragCentre(page: Page, dx: number) {
  const box = (await page.getByTestId("cloud-canvas").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.mouse.up({ button: "left" });
}

test("EDL is off under reduced effects, follows the setting, and never renders to a target", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("kestrel.effects", "reduced"));
  await openGrid(page);
  expect(await page.evaluate(() => window.__kestrelCloudViewer!.edl())).toEqual({
    on: false,
    rendersToTarget: false,
  });
  await page.evaluate(() => {
    document.documentElement.dataset.effects = "full";
  });
  await expect.poll(() => page.evaluate(() => window.__kestrelCloudViewer!.edl().on)).toBe(true);
  // with EDL on the cloud still draws in its own colours, and no pixel is blown out to white
  const c = await page.evaluate(() => window.__kestrelCloudViewer!.sampleColours());
  expect(c.red / c.total).toBeGreaterThan(0.01);
  expect(c.green / c.total).toBeGreaterThan(0.01);
  expect(c.white).toBe(0);
});

test("setView tweens to the named view in about 350 ms; a drag stops it; reduced motion jumps at once", async ({
  page,
}) => {
  await openGrid(page);
  await edlOn(page);
  // read in the same round trip as setView: a slow run could otherwise finish the 350 ms tween first
  const early = await page.evaluate(() => {
    const h = window.__kestrelCloudViewer!;
    h.setView("front");
    return h.cameraPose()!;
  });
  expect(Math.abs(early.position[2] - early.target[2])).toBeGreaterThan(1); // still on its way down
  await expect
    .poll(
      async () => {
        const p = await pose(page);
        return Math.abs(p.position[2] - p.target[2]) < 1e-3 && p.position[1] < p.target[1];
      },
      { timeout: 2_000 },
    )
    .toBe(true);

  // a drag during a tween wins: the camera stays where the drag left it
  await page.evaluate(() => window.__kestrelCloudViewer!.setView("iso"));
  await dragCentre(page, 120);
  const afterDrag = await pose(page);
  await page.waitForTimeout(600); // longer than the tween: had it kept running, the camera would move on
  const later = await pose(page);
  later.position.forEach((v, i) => expect(v).toBeCloseTo(afterDrag.position[i], 6));
  later.target.forEach((v, i) => expect(v).toBeCloseTo(afterDrag.target[i], 6));

  await page.emulateMedia({ reducedMotion: "reduce" });
  const side = await page.evaluate(() => {
    const h = window.__kestrelCloudViewer!;
    h.setView("side");
    return h.cameraPose()!;
  });
  expect(side.position[0]).toBeGreaterThan(side.target[0]);
  expect(Math.abs(side.position[1] - side.target[1])).toBeLessThan(1e-3);
  expect(Math.abs(side.position[2] - side.target[2])).toBeLessThan(1e-3);
});

test("orbit keeps the target on a left drag; pan moves it; fly applies", async ({ page }) => {
  await openGrid(page);
  await edlOn(page);
  expect(await page.evaluate(() => window.__kestrelCloudViewer!.navMode())).toBe("orbit");
  const before = await pose(page);
  await dragCentre(page, 80);
  const orbited = await pose(page);
  orbited.target.forEach((v, i) => expect(v).toBeCloseTo(before.target[i], 6));
  expect(orbited.position).not.toEqual(before.position);

  await page.evaluate(() => window.__kestrelCloudViewer!.setNavMode("pan"));
  expect(await page.evaluate(() => window.__kestrelCloudViewer!.navMode())).toBe("pan");
  await dragCentre(page, 80);
  const panned = await pose(page);
  expect(Math.hypot(...panned.target.map((v, i) => v - orbited.target[i]))).toBeGreaterThan(0.1);

  await page.evaluate(() => window.__kestrelCloudViewer!.setNavMode("fly"));
  expect(await page.evaluate(() => window.__kestrelCloudViewer!.navMode())).toBe("fly"); // C-V2
  await page.evaluate(() => window.__kestrelCloudViewer!.setNavMode("pan"));
  expect(await page.evaluate(() => window.__kestrelCloudViewer!.navMode())).toBe("pan");
});

test("the frame hook reports the camera, frame times fill during an orbit, and the loop idles after", async ({
  page,
}) => {
  await openGrid(page);
  await edlOn(page);
  const f = await page.evaluate(() => window.__kestrelCloudViewer!.lastFrame());
  expect(f).not.toBeNull();
  expect(f!.viewProj).toHaveLength(16);
  const canvas = (await page.getByTestId("cloud-canvas").boundingBox())!;
  expect(f!.rect.width).toBeCloseTo(canvas.width, 0);
  expect(Math.hypot(...f!.direction)).toBeCloseTo(1, 6);

  const before = await pose(page);
  await page.evaluate(() => window.__kestrelCloudViewer!.scriptOrbit(1));
  const times = await page.evaluate(() => window.__kestrelCloudViewer!.frameTimes());
  expect(times.length).toBeGreaterThan(5);
  expect(times.length).toBeLessThanOrEqual(600);
  expect(times.every((t) => t > 0 && t <= 500)).toBe(true);
  const after = await pose(page);
  expect(after.position[2]).toBeCloseTo(before.position[2], 6); // turned about the vertical
  expect(after.position).not.toEqual(before.position);

  await page.waitForTimeout(1_200); // IDLE_AFTER_MS
  const n = (await page.evaluate(() => window.__kestrelCloudViewer!.frameTimes())).length;
  await page.waitForTimeout(1_000);
  expect((await page.evaluate(() => window.__kestrelCloudViewer!.frameTimes())).length).toBe(n);
});

test("the top snapshot is 512 px, west red and east green, with EDL on and still on after", async ({
  page,
}) => {
  await openGrid(page);
  await edlOn(page);
  const s = await page.evaluate(() => window.__kestrelCloudViewer!.topSnapshotSample(512));
  expect(s).not.toBeNull();
  expect([s!.width, s!.height]).toEqual([512, 512]);
  expect(s!.left.red).toBeGreaterThan(s!.left.green);
  expect(s!.right.green).toBeGreaterThan(s!.right.red);
  expect(s!.left.white + s!.right.white).toBe(0);
  expect(await page.evaluate(() => window.__kestrelCloudViewer!.edl().on)).toBe(true);
  // the main view still draws after the off-screen render
  const c = await page.evaluate(() => window.__kestrelCloudViewer!.sampleColours());
  expect(c.red / c.total).toBeGreaterThan(0.01);
});
