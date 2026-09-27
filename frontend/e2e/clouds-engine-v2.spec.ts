// frontend/e2e/clouds-engine-v2.spec.ts
import { test, expect, type Page } from "@playwright/test";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";
import {
  buildOctree,
  hollowBox,
  redGreenGrid,
  routeOctree,
  type FixturePoint,
} from "./fixtures/potreeOctree";
import { SWIFTSHADER_ARGS, edlOn, viewerSettled } from "./fixtures/viewer";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

test.use({ launchOptions: { args: SWIFTSHADER_ARGS } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kestrel.diagnostics", "1"));
});

async function openCloud(page: Page, points: FixturePoint[], bounds: number[]) {
  const cloud = cloudJson({ bounds_native: bounds, point_count: points.length });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloud] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloud);
  await routeOctree(page, CLOUD, buildOctree(points));
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);
}

const GRID_BOUNDS = [243500, 3178000, 0, 243600, 3178100, 2];
const openGrid = (page: Page, step = 2) =>
  openCloud(page, redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step }), GRID_BOUNDS);

const C = { x: 243550, y: 3178050, z: 5 };
const BOX = hollowBox({ centre: [C.x, C.y, C.z], half: 5, step: 0.2 });
const BOX_BOUNDS = [C.x - 5, C.y - 5, 0, C.x + 5, C.y + 5, 10];
/** Keeps y in [cy, cy + 6]: the north wall only. */
const NORTH_ONLY = {
  centre: [C.x, C.y + 3, C.z] as [number, number, number],
  size: [12, 6, 12] as [number, number, number],
  yawDeg: 0,
};

/** The front view from the south, nodes loaded (setView jumps at once under reduced motion). */
async function frontSettled(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" }); // setView jumps at once (V1 Ruling 5)
  await page.evaluate(() => window.__kestrelCloudViewer!.setView("front"));
  await viewerSettled(page);
}

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test("clip box: show-inside picks land inside the box, highlight picks what is drawn (EDL on)", async ({
  page,
}) => {
  await openCloud(page, BOX, BOX_BOUNDS);
  await edlOn(page);
  await frontSettled(page);
  const front = await page.evaluate(() => window.__kestrelCloudViewer!.pickCenter());
  expect(front!.y).toBeCloseTo(C.y - 5, 0); // the south wall, nearest the camera
  await page.evaluate((b) => window.__kestrelCloudViewer!.setClipBox(b, "show_inside"), NORTH_ONLY);
  const inside = await page.evaluate(() => window.__kestrelCloudViewer!.pickCenter());
  expect(inside!.y).toBeCloseTo(C.y + 5, 0); // the north wall, the only one inside
  await page.evaluate((b) => window.__kestrelCloudViewer!.setClipBox(b, "highlight_inside"), NORTH_ONLY);
  const hl = await page.evaluate(() => window.__kestrelCloudViewer!.pickCenter());
  expect(hl!.y).toBeCloseTo(C.y - 5, 0);
  await page.evaluate(() => window.__kestrelCloudViewer!.setClipBox(null));
  const off = await page.evaluate(() => window.__kestrelCloudViewer!.pickCenter());
  expect(off!.y).toBeCloseTo(C.y - 5, 0);
});

test("fly: W moves along the view while held, the loop stays alive, leaving puts the target 10 m ahead", async ({
  page,
}) => {
  await openGrid(page);
  await page.evaluate(() => window.__kestrelCloudViewer!.setNavMode("fly"));
  expect(await page.evaluate(() => window.__kestrelCloudViewer!.navMode())).toBe("fly");
  const before = await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose()!);
  await page.waitForTimeout(1_200); // past the idle rule: only the held key can keep the loop running
  await page.keyboard.down("w");
  await page.waitForTimeout(1_300);
  const mid = await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose()!);
  await page.waitForTimeout(400);
  const late = await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose()!);
  await page.keyboard.up("w");
  expect(dist(mid.position, before.position)).toBeGreaterThan(1);
  expect(
    dist(late.position, mid.position),
    "the loop must keep running past 1 s while W is held",
  ).toBeGreaterThan(0.1);
  expect(dist(late.target, late.position)).toBeCloseTo(10, 3); // in fly, the pose's target is 10 m ahead
  await page.evaluate(() => window.__kestrelCloudViewer!.setNavMode("orbit"));
  const after = await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose()!);
  expect(dist(after.target, after.position)).toBeCloseTo(10, 1);
});

test("lookThrough fits the photo in the canvas and maps its centre to the canvas centre", async ({
  page,
}) => {
  await openGrid(page);
  const got = await page.evaluate(() =>
    window.__kestrelCloudViewer!.lookThrough({
      position: [243550, 3178050, 60],
      forward: [0, 0, -1],
      up: [0, 1, 0],
      hfovDeg: 73.7,
      vfovDeg: 53.1,
      width: 4000,
      height: 3000,
    }),
  );
  const canvas = (await page.getByTestId("cloud-canvas").boundingBox())!;
  expect(got.centre.x).toBeCloseTo(canvas.x + canvas.width / 2, 0);
  expect(got.centre.y).toBeCloseTo(canvas.y + canvas.height / 2, 0);
  expect(got.frame.width).toBeLessThanOrEqual(canvas.width + 0.5);
  expect(got.frame.height).toBeLessThanOrEqual(canvas.height + 0.5);
  expect(Math.max(got.frame.width / canvas.width, got.frame.height / canvas.height)).toBeCloseTo(1, 2);
  const pose = await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose()!);
  expect(pose.position).toEqual([243550, 3178050, 60]);
  expect(pose.up).toEqual([0, 1, 0]);
});

test("a second lookThrough, then restore, goes back to the pose before the first, Z-up (review I1)", async ({
  page,
}) => {
  await openGrid(page);
  const before = await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose()!);
  const photo = (x: number, up: [number, number, number]) => ({
    position: [x, 3178050, 60] as [number, number, number],
    forward: [0, 0, -1] as [number, number, number],
    up,
    hfovDeg: 73.7,
    vfovDeg: 53.1,
    width: 4000,
    height: 3000,
  });
  await page.evaluate((p) => window.__kestrelCloudViewer!.lookThrough(p), photo(243540, [0, 1, 0]));
  await page.evaluate((p) => window.__kestrelCloudViewer!.lookThrough(p), photo(243560, [1, 0, 0]));
  await page.evaluate(() => window.__kestrelCloudViewer!.restoreLook());
  const after = await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose()!);
  after.position.forEach((v, i) => expect(v).toBeCloseTo(before.position[i], 6));
  after.target.forEach((v, i) => expect(v).toBeCloseTo(before.target[i], 6));
  expect(after.up).toEqual([0, 0, 1]);
  expect(after.fov_deg).toBeCloseTo(before.fov_deg, 6);
});

test("sampleSlab reads the loaded points in float64 along the line", async ({ page }) => {
  await openGrid(page, 1);
  const r = await page.evaluate(() =>
    window.__kestrelCloudViewer!.sampleSlab([243500, 3178050, 0], [243600, 3178050, 0], 1),
  );
  expect(r.count).toBeGreaterThan(0);
  expect(r.s.length).toBe(Math.min(r.count, 5000));
  expect(Math.min(...r.s)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...r.s)).toBeLessThanOrEqual(100);
  // the grid's z is 0.02 · (x − origin): a float32 UTM offset error would break this at the mm level
  const maxResidual = Math.max(...r.s.map((s, i) => Math.abs(r.z[i] - 0.02 * s)));
  expect(maxResidual).toBeLessThan(0.01);
});

test("Fit and the named views put the default FOV back after a stored pose or a photo pose", async ({
  page,
}) => {
  await openGrid(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() =>
    window.__kestrelCloudViewer!.goToPose({
      position: [243550, 3177950, 80],
      target: [243550, 3178050, 0],
      up: [0, 0, 1],
      fov_deg: 30,
    }),
  );
  expect((await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose()!)).fov_deg).toBeCloseTo(30, 6);
  await page.evaluate(() => window.__kestrelCloudViewer!.setView("fit"));
  expect((await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose()!)).fov_deg).toBeCloseTo(60, 6);
  await page.evaluate(() =>
    window.__kestrelCloudViewer!.lookThrough({
      position: [243550, 3178050, 60],
      forward: [0, 0, -1],
      up: [0, 1, 0],
      hfovDeg: 73.7,
      vfovDeg: 53.1,
      width: 4000,
      height: 3000,
    }),
  );
  await page.evaluate(() => window.__kestrelCloudViewer!.setView("top"));
  const p = await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose()!);
  expect(p.fov_deg).toBeCloseTo(60, 6);
  expect(p.up).toEqual([0, 0, 1]);
});

test("occlusion: after settle, a point behind the south wall is hidden; the clip box clears it", async ({
  page,
}) => {
  await openCloud(page, BOX, BOX_BOUNDS);
  await frontSettled(page);
  const run = () =>
    page.evaluate(
      ([x, y, z]) =>
        window.__kestrelCloudViewer!.occlusion(
          [
            [x, y + 5, z], // the north wall's centre, behind the south wall
            [x, y - 5, z], // the south wall's centre, in front
          ],
          [0.3, 0.3],
        ),
      [C.x, C.y, C.z],
    );
  await expect.poll(async () => (await run()).result, { timeout: 5_000 }).toEqual([true, false]);
  const timed = await run();
  console.log(
    `occlusion pass: ${timed.ms.toFixed(1)} ms (target <= 40 ms on the operator's laptop; SwiftShader reported only)`,
  );
  await page.evaluate((b) => window.__kestrelCloudViewer!.setClipBox(b, "show_inside"), NORTH_ONLY);
  await expect.poll(async () => (await run()).result, { timeout: 5_000 }).toEqual([false, false]);
});

test("occlusion answers null while the view is moving", async ({ page }) => {
  await openCloud(page, BOX, BOX_BOUNDS);
  const r = await page.evaluate(
    ([x, y, z]) => {
      const h = window.__kestrelCloudViewer!;
      h.setView("front"); // starts the tween: the loop is running
      return h.occlusion([[x, y + 5, z]], [0.3]).result;
    },
    [C.x, C.y, C.z],
  );
  expect(r).toBeNull();
});

test("a capture is 1600 x 1000, not uniform, red and green, and the screen comes back", async ({ page }) => {
  await openGrid(page, 1);
  await edlOn(page); // EDL on screen; the capture is taken without it (plan Ruling 5)
  const shot = await page.evaluate(() => window.__kestrelCloudViewer!.captureSample([]));
  console.log(`capture: ${shot.ms.toFixed(0)} ms, complete ${shot.complete}`);
  expect(shot).toMatchObject({ width: 1600, height: 1000, type: "image/png", complete: true, edl: false });
  const c = shot.colours;
  expect(c.background, "the background is the canvas token, byte for byte (plan Ruling 6)").toBeGreaterThan(
    0,
  );
  expect(c.background, "a blank read-back is uniform").toBeLessThan(c.total);
  expect(c.red / c.total).toBeGreaterThan(0.01);
  expect(c.green / c.total).toBeGreaterThan(0.01);
  expect(c.white, "the S1 white-colour trap").toBe(0);
  // resumed: the chip is gone, the loop draws again, and still in both colours
  await expect(page.getByTestId("cloud-saving-view")).toHaveCount(0);
  await viewerSettled(page);
  const screen = await page.evaluate(() => window.__kestrelCloudViewer!.sampleColours());
  expect(screen.red / screen.total).toBeGreaterThan(0.01);
  expect(screen.green / screen.total).toBeGreaterThan(0.01);
  // sampleColours draws a frame itself: prove the loop itself runs again (a tween only a live tick moves).
  // The fit view looks from the south, well off the vertical; the top view is a hair off straight down.
  const offVertical = async () => {
    const p = await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose()!);
    return (
      Math.hypot(p.position[0] - p.target[0], p.position[1] - p.target[1]) / (p.position[2] - p.target[2])
    );
  };
  expect(await offVertical()).toBeGreaterThan(0.5);
  await page.evaluate(() => window.__kestrelCloudViewer!.setView("top")); // not reduced motion: a tween
  await expect.poll(offVertical, { timeout: 2_000 }).toBeLessThan(1e-3);
  // and it goes idle again: the occlusion pass answers (not frozen, no frame pending)
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__kestrelCloudViewer!.occlusion([[243550, 3178050, 1]], [0.3])))
          .result,
      { timeout: 5_000 },
    )
    .not.toBeNull();
});

test("a finding mark is drawn as a white-ringed pin", async ({ page }) => {
  await openGrid(page, 1);
  const shot = await page.evaluate(() =>
    window.__kestrelCloudViewer!.captureSample([{ kind: "finding", at: [243550, 3178050, 1] }]),
  );
  expect(shot.colours.white).toBeGreaterThan(50);
  expect(shot.colours.white / shot.colours.total).toBeLessThan(0.01);
});

test("a second capture while one runs is refused, and the chip shows", async ({ page }) => {
  await openGrid(page);
  const got = await page.evaluate(async () => {
    let chipSeen = false;
    const obs = new MutationObserver(() => {
      if (document.querySelector('[data-testid="cloud-saving-view"]')) chipSeen = true;
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const h = window.__kestrelCloudViewer!;
    const first = h.captureSample([]);
    const second = await h.captureSample([]).then(
      () => "accepted",
      (e: Error) => e.message,
    );
    await first;
    await new Promise((r) => setTimeout(r, 0)); // the observer's last records
    obs.disconnect();
    return { second, chipSeen };
  });
  expect(got.second).toBe("a capture is already running");
  expect(got.chipSeen).toBe(true);
  await expect(page.getByTestId("cloud-saving-view")).toHaveCount(0);
});

test("pickWithNormal: the south wall seen from the south has a normal facing south", async ({ page }) => {
  // dense enough that the 15 px window holds well over 8 points at the front view's distance
  await openCloud(page, hollowBox({ centre: [C.x, C.y, C.z], half: 5, step: 0.05 }), BOX_BOUNDS);
  await frontSettled(page);
  const got = await page.evaluate(() => window.__kestrelCloudViewer!.pickCenterWithNormal());
  expect(got).not.toBeNull();
  const plain = await page.evaluate(() => window.__kestrelCloudViewer!.pickCenter());
  expect(got!.point).toEqual([plain!.x, plain!.y, plain!.z]); // the same pick as pickAtClient
  expect(got!.normal).not.toBeNull();
  expect(got!.normal![1]).toBeLessThan(-0.95);
});
