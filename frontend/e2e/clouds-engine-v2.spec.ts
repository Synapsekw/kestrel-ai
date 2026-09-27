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
