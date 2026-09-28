import { test, expect, type Page } from "@playwright/test";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";
import { buildOctree, redGreenGrid, routeOctree, type FixturePoint } from "./fixtures/potreeOctree";
import { engineIdle } from "./fixtures/cloudWorkspace";
import { SWIFTSHADER_ARGS, viewerSettled } from "./fixtures/viewer";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const TYPE = "t0000000-1111-4000-8000-00000000c0a1";
const CORS = { "Access-Control-Allow-Origin": "*" };

// WebGL only on SwiftShader (vault/decisions/2026-09-26-gotcha-swiftshader-compositing.md).
test.use({ launchOptions: { args: SWIFTSHADER_ARGS } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kestrel.diagnostics", "1"));
});

const pinsDiag = (page: Page) => page.evaluate(() => window.__kestrelCloudViewer?.pins() ?? []);

/** The mock's project, plus one defect type the pin tool can use. */
async function routeProjectWithType(page: Page) {
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}`,
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const res = await route.fetch();
      const body = (await res.json()) as { classes?: unknown[] };
      body.classes = [
        ...(body.classes ?? []),
        {
          id: TYPE,
          name: "Spalling",
          colour: "#ff9c3a",
          hotkey: null,
          order: 99,
          kind: "defect",
          default_severity: 3,
          group: "Concrete defects",
        },
      ];
      await route.fulfill({ response: res, json: body });
    },
  );
}

function finding(id: string, number: number, anchor: { x: number; y: number; z: number }) {
  return {
    id,
    number,
    type_id: TYPE,
    severity: 3,
    status: "open",
    note: "",
    created_by: "human",
    confidence: null,
    anchor: { kind: "cloud", cloud_id: CLOUD, ...anchor, uncertainty_m: 0.05 },
    lon: null,
    lat: null,
    data_type: "point_cloud",
    data_id: CLOUD,
    created_at: "2026-09-27T10:00:00Z",
    updated_at: "2026-09-27T10:00:00Z",
    reviewed_at: null,
    closed_at: null,
  };
}

/** An in-memory findings list for this cloud: GET lists it, POST appends to it. */
async function routeFindings(page: Page, items: ReturnType<typeof finding>[]) {
  const posts: Record<string, unknown>[] = [];
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: "application/json",
    headers: CORS,
    body: JSON.stringify(body),
  });
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/findings`,
    async (route) => {
      const r = route.request();
      if (r.method() === "GET") return route.fulfill(json({ items, next_cursor: null }));
      if (r.method() !== "POST") return route.fallback();
      const body = r.postDataJSON() as { anchor: { x: number; y: number; z: number } };
      posts.push(body as unknown as Record<string, unknown>);
      const f = finding(
        `f0000000-0000-4000-8000-${String(items.length + 1).padStart(12, "0")}`,
        300 + items.length,
        body.anchor,
      );
      items.push(f);
      return route.fulfill(json({ ...f, attachment_count: 0, comment_count: 0 }, 201));
    },
  );
  await page.route(
    (u) => /\/findings\/f0000000-[^/]+$/.test(u.pathname),
    (route) => {
      const id = route.request().url().split("/").pop()!.split("?")[0];
      const f = items.find((x) => x.id === id);
      return f ? route.fulfill(json({ ...f, attachment_count: 0, comment_count: 0 })) : route.fallback();
    },
  );
  await page.route(
    (u) => /\/findings\/[^/]+\/attachments$/.test(u.pathname),
    (route) => (route.request().method() === "GET" ? route.fulfill(json({ items: [] })) : route.fallback()),
  );
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}/views`, { items: [] });
  return posts;
}

async function routeCloud(page: Page, points: FixturePoint[], bounds: number[]) {
  const cloud = cloudJson({ bounds_native: bounds, point_count: points.length });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloud] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloud);
  await routeOctree(page, CLOUD, buildOctree(points));
}

test("pin flow: M, pick, choose a type, Enter creates with F's cloud anchor, the pin stays after reload", async ({
  page,
}) => {
  await routeProjectWithType(page);
  const grid = redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 });
  await routeCloud(page, grid, [243500, 3178000, 0, 243600, 3178100, 2]);
  const posts = await routeFindings(page, []);
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);

  await page.keyboard.press("m");
  const toolbar = page.getByRole("toolbar", { name: "Point cloud tools" });
  await expect(toolbar.getByRole("button", { name: "Pin a finding" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const canvas = page.getByTestId("cloud-canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const form = page.getByTestId("pin-callout-create");
  await expect(form).toBeVisible();
  await expect(form.getByRole("button", { name: "Create" })).toBeDisabled();
  await form.getByRole("button", { name: /^Type:/ }).click();
  await page.getByRole("listbox").getByText("Spalling").click();
  // the pick moves focus to the note; a plain Enter there creates (final-review ruling)
  await expect(form.getByRole("textbox", { name: "Note" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect.poll(() => posts.length).toBe(1);
  const anchor = posts[0].anchor as Record<string, unknown>;
  expect(Object.keys(anchor).sort()).toEqual(["cloud_id", "kind", "uncertainty_m", "x", "y", "z"]);
  expect(anchor.kind).toBe("cloud");
  expect(anchor.cloud_id).toBe(CLOUD);
  expect(posts[0].type_id).toBe(TYPE);
  expect(posts[0].severity).toBe(3);
  await expect(page.getByTestId("cloud-pin")).toHaveCount(1);
  // C-R1 is not on main (view3d capture is a no-op): the normal recorded at pick time is on the
  // diagnostics pin row instead of being asserted from an uploaded view (ledger ruling T11-2).
  await expect.poll(async () => (await pinsDiag(page))[0]?.normal).not.toBeNull();

  await page.reload();
  await viewerSettled(page);
  await expect(page.getByTestId("cloud-pin")).toHaveCount(1);
  await expect.poll(async () => (await pinsDiag(page))[0]?.state).toBe("visible");
});

/** A 16 m × 8 m wall at y = 3178050, and a ground grid; the default view looks from the south. */
function wallAndGround(): FixturePoint[] {
  const out: FixturePoint[] = [];
  for (let x = -8; x <= 8; x += 0.1)
    for (let z = 0; z <= 8; z += 0.1) out.push({ x: 243550 + x, y: 3178050, z, r: 200, g: 60, b: 60 });
  for (let x = -12; x <= 12; x += 0.5)
    for (let y = -12; y <= 12; y += 0.5)
      out.push({ x: 243550 + x, y: 3178050 + y, z: 0, r: 60, g: 200, b: 60 });
  return out;
}

test("occlusion: a pin behind the wall gets back after settle, a pin in front stays visible", async ({
  page,
}) => {
  await routeProjectWithType(page);
  await routeCloud(page, wallAndGround(), [243538, 3178038, 0, 243562, 3178062, 8]);
  await routeFindings(page, [
    finding("f0000000-0000-4000-8000-000000000001", 1, { x: 243550, y: 3178053, z: 2 }), // behind (north of) the wall
    // on the ground in front; z = 0.3 (not 0) so the pin does not sit exactly on the ground grid's
    // own points — a pin coincident with the surface it is pinned to reads as self-occluded.
    finding("f0000000-0000-4000-8000-000000000002", 2, { x: 243550, y: 3178044, z: 0.3 }),
  ]);
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);
  // The default south-oblique view already looks the right way (preflight T11-5: bounds 24x24x8, the
  // ray to the rear pin crosses the wall plane at z approx 4.5, inside the wall's 0-8 m span).
  await expect.poll(async () => (await pinsDiag(page)).length, { timeout: 10_000 }).toBe(2);
  await expect
    .poll(async () => Object.fromEntries((await pinsDiag(page)).map((p) => [p.id.slice(-1), p.state])), {
      timeout: 10_000,
    })
    .toEqual({ "1": "back", "2": "visible" });
});

/** A flat 200 × 200 m ground (2 m grid, z = 0) with a 20 × 20 m roof (1 m grid) at z = 15 over its
 * centre: the whole site in view puts about 0.6 m on a pixel. */
function groundAndRoof(): FixturePoint[] {
  const out: FixturePoint[] = [];
  for (let x = -100; x <= 100; x += 2)
    for (let y = -100; y <= 100; y += 2)
      out.push({ x: 243550 + x, y: 3178050 + y, z: 0, r: 60, g: 200, b: 60 });
  for (let x = -10; x <= 10; x += 1)
    for (let y = -10; y <= 10; y += 1)
      out.push({ x: 243550 + x, y: 3178050 + y, z: 15, r: 200, g: 60, b: 60 });
  return out;
}

test("occlusion, whole site in view: a pin on open ground stays visible, a pin under the roof gets back", async ({
  page,
}) => {
  // Task 17 (the chimney's rim pin): with the whole cloud in view the 3 px disk around a pin spans
  // metres, and the pin's own surface seen obliquely has drawn points in it nearer than the pin by
  // more than the tolerance. Only points on the line of sight may occlude.
  await routeProjectWithType(page);
  await routeCloud(page, groundAndRoof(), [243450, 3177950, 0, 243650, 3178150, 15]);
  await routeFindings(page, [
    finding("f0000000-0000-4000-8000-000000000001", 1, { x: 243600, y: 3178000, z: 0 }), // open ground
    finding("f0000000-0000-4000-8000-000000000002", 2, { x: 243550, y: 3178050, z: 0 }), // under the roof
  ]);
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);
  await expect.poll(async () => (await pinsDiag(page)).length, { timeout: 10_000 }).toBe(2);
  for (const view of ["iso", "top"] as const) {
    await page.evaluate((v) => window.__kestrelCloudViewer!.setView(v), view);
    await viewerSettled(page);
    await expect
      .poll(async () => Object.fromEntries((await pinsDiag(page)).map((p) => [p.id.slice(-1), p.state])), {
        timeout: 10_000,
      })
      .toEqual({ "1": "visible", "2": "back" });
  }
});

test("idle: 0 animation frames and no running animation 1 s after settle with 50 pins", async ({ page }) => {
  await routeProjectWithType(page);
  const grid = redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 });
  await routeCloud(page, grid, [243500, 3178000, 0, 243600, 3178100, 2]);
  const fifty = Array.from({ length: 50 }, (_, i) =>
    finding(`f0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, i + 1, {
      x: 243510 + (i % 10) * 8,
      y: 3178010 + Math.floor(i / 10) * 16,
      z: 1,
    }),
  );
  await routeFindings(page, fifty);
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: number };
    const raf = window.requestAnimationFrame.bind(window);
    w.__frames = 0;
    window.requestAnimationFrame = (cb) => {
      w.__frames++;
      return raf(cb);
    };
  });
  const navStart = Date.now();
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);
  await expect(page.getByTestId("cloud-pin")).toHaveCount(50);
  // The Orbit hint bar auto-fades once, HINT_FADE_MS = 2400 ms after mount (workspace/tools.ts), a
  // ~180ms opacity transition unrelated to pins; wait past it (from navigation, not from settle, since
  // the fade timer starts at mount) so it can never land inside the idle measurement window below.
  const pastHintFade = 2_400 + 500 - (Date.now() - navStart);
  if (pastHintFade > 0) await page.waitForTimeout(pastHintFade);
  await page.waitForTimeout(1_200);
  // and the loop has stopped (C-G final review C1: a fixed wait can open on the loop's own tail)
  await engineIdle(page);
  const frames = () => page.evaluate(() => (window as unknown as { __frames: number }).__frames);
  const before = await frames();
  await page.waitForTimeout(1_000);
  expect(await frames()).toBe(before);
  // Excludes the project's "Jobs running" live dot (`animate-pulse-dot`, `iterations: Infinity` by
  // design, tailwind.config.ts): a looping, job-driven indicator unrelated to the pins layer, the
  // same exclusion e2e/evidence.ts's `entrancesDone` uses for looping animations.
  const running = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity).length,
  );
  expect(running).toBe(0);
  // reported, not asserted as a budget on SwiftShader (C-G asserts on the laptop): the last pin pass
  const rows = await pinsDiag(page);
  const pass = rows[0]?.passMs ?? -1;
  console.info(`pins pass with 50 pins: ${pass.toFixed(3)} ms`);
  expect(rows).toHaveLength(50);
});

// C-G final review m7: findings that answer after the view has settled are placed without a camera
// move (the layer asks for one frame), and the loop idles again after it.
test("findings that answer after settle get their pin without a camera move, then the loop idles", async ({
  page,
}) => {
  await routeProjectWithType(page);
  const grid = redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 });
  await routeCloud(page, grid, [243500, 3178000, 0, 243600, 3178100, 2]);
  const late = "f0000000-0000-4000-8000-000000000077";
  await routeFindings(page, [finding(late, 77, { x: 243550, y: 3178050, z: 1 })]);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/findings`,
    async (route) => {
      if (route.request().method() === "GET") await held;
      return route.fallback();
    },
  );
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: number };
    const raf = window.requestAnimationFrame.bind(window);
    w.__frames = 0;
    window.requestAnimationFrame = (cb) => {
      w.__frames++;
      return raf(cb);
    };
  });
  const frames = () => page.evaluate(() => (window as unknown as { __frames: number }).__frames);
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);
  await engineIdle(page);
  expect(await pinsDiag(page)).toEqual([]);
  const pose = await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose());
  release();
  await expect
    .poll(async () =>
      (await pinsDiag(page)).map((p) => ({
        id: p.id,
        placed: p.state !== "hidden" && Number.isFinite(p.x) && Number.isFinite(p.y),
      })),
    )
    .toEqual([{ id: late, placed: true }]);
  expect(await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose())).toEqual(pose);
  await engineIdle(page);
  const before = await frames();
  await page.waitForTimeout(1_000);
  expect(await frames()).toBe(before);
});
