import { test, expect, type Page, type Request } from "@playwright/test";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";
import { buildOctree, redGreenGrid, routeOctree } from "./fixtures/potreeOctree";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
/** The Findings tab's MenuButton (C-W1 Inspector, named by R1). */
const FINDINGS_MENU = "Findings actions";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "*",
};

// WebGL on SwiftShader for WebGL only (vault/decisions/2026-09-26-gotcha-swiftshader-compositing.md).
test.use({ launchOptions: { args: ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"] } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kestrel.diagnostics", "1"));
});

const finding = (id: string, x: number) => ({
  id,
  number: 1,
  type_id: "t0000000-1111-4000-8000-000000000001",
  severity: 3,
  status: "open",
  note: "",
  created_by: "human",
  confidence: null,
  anchor: { kind: "cloud", cloud_id: CLOUD, x, y: 3178050, z: 1, uncertainty_m: 0.05 },
  lon: 48.375,
  lat: 28.704,
  data_type: "point_cloud",
  data_id: CLOUD,
  created_at: "2026-09-27T10:00:00Z",
  updated_at: "2026-09-27T10:00:00Z",
  reviewed_at: null,
  closed_at: null,
});
const F1 = "f0000000-3333-4000-8000-000000000001";
const F2 = "f0000000-3333-4000-8000-000000000002";
const measurement = {
  id: "m0000000-4444-4000-8000-000000000001",
  point_cloud_id: CLOUD,
  kind: "distance",
  name: "Distance 1",
  note: null,
  points: [
    { x: 243520, y: 3178020, z: 1, uncertainty_m: 0.02 },
    { x: 243560, y: 3178060, z: 1, uncertainty_m: 0.02 },
  ],
  results: {},
  params: null,
  status: "ready",
  error: null,
  job_id: null,
  finding_id: null,
  view: null,
  created_at: "2026-09-27T10:00:00Z",
  updated_at: "2026-09-27T10:00:00Z",
};

interface Upload {
  path: string;
  png: Buffer;
  meta: {
    pose: { position: number[]; target: number[]; up: number[]; fov_deg: number };
    render: Record<string, unknown>;
  };
}

/** The image part and the JSON meta part of one multipart PUT, split on its own boundary. */
function parseUpload(req: Request): Upload {
  const type = req.headers()["content-type"] ?? "";
  const boundary = `\r\n--${type.split("boundary=")[1]}`;
  const body = req.postDataBuffer()!;
  const part = (name: string) => {
    const at = body.indexOf(`name="${name}"`);
    const start = body.indexOf("\r\n\r\n", at) + 4;
    return body.subarray(start, body.indexOf(boundary, start));
  };
  return {
    path: new URL(req.url()).pathname,
    png: part("image"),
    meta: JSON.parse(part("meta").toString("utf8")),
  };
}

async function routeWorkspace(page: Page, opts: { holdSecond?: Promise<void> } = {}) {
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson()] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  await jsonRoute(page, `/api/v1/projects/${P}/findings`, {
    items: [finding(F1, 243530), finding(F2, 243570)],
    next_cursor: null,
  });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}/measurements`, { items: [measurement] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}/views`, { items: [] });
  const uploads: Upload[] = [];
  await page.route(
    (u) => u.pathname.endsWith("/view3d"),
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      if (req.method() !== "PUT") return route.fallback();
      const up = parseUpload(req);
      uploads.push(up);
      if (uploads.length === 2 && opts.holdSecond) await opts.holdSecond;
      const isFinding = up.path.includes("/findings/");
      return route.fulfill({
        status: 200,
        headers: CORS,
        contentType: "application/json",
        body: JSON.stringify({
          subject_kind: isFinding ? "finding" : "cloud_measurement",
          subject_id: up.path.split("/").at(-2),
          pose: up.meta.pose,
          render: up.meta.render,
          anchor_normal: null,
          sha256: `${uploads.length}`.padStart(64, "0"),
          bytes: up.png.length,
          width: 1600,
          height: 1000,
          captured_at: "2026-09-27T10:00:00Z",
          stale: false,
        }),
      });
    },
  );
  return uploads;
}

async function openSettled(page: Page) {
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await expect
    .poll(async () => page.evaluate(() => window.__kestrelCloudViewer?.stats().settledMs ?? null), {
      timeout: 20_000,
    })
    .not.toBeNull();
}

async function startCaptureMissing(page: Page) {
  await page.getByRole("tab", { name: /Findings/ }).click();
  await page.getByRole("button", { name: FINDINGS_MENU }).click();
  await page.getByRole("menuitem", { name: "Capture missing views" }).click();
}

/** How many distinct colours (5 bits a channel) a 40 × 25 grid of the image holds, decoded in the page. */
async function distinctColours(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const seen = new Set<string>();
    for (let y = 0; y < 25; y += 1)
      for (let x = 0; x < 40; x += 1) {
        const d = ctx.getImageData(Math.floor((x + 0.5) * 40), Math.floor((y + 0.5) * 40), 1, 1).data;
        seen.add(`${d[0] >> 3},${d[1] >> 3},${d[2] >> 3}`);
      }
    return seen.size;
  }, png.toString("base64"));
}

test("Capture missing views saves a 1600 x 1000 PNG with its pose for each of 3 subjects", async ({
  page,
}) => {
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 })),
  );
  const uploads = await routeWorkspace(page);
  await openSettled(page);
  await startCaptureMissing(page);
  await expect(page.getByText(/Saving views [0-3] \/ 3/)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => uploads.length, { timeout: 30_000 }).toBe(3);
  await expect(page.getByText(/Saving views/)).toBeHidden();
  expect(uploads.map((u) => u.path)).toEqual([
    `/api/v1/projects/${P}/findings/${F1}/view3d`,
    `/api/v1/projects/${P}/findings/${F2}/view3d`,
    `/api/v1/projects/${P}/pointclouds/${CLOUD}/measurements/${measurement.id}/view3d`,
  ]);
  for (const up of uploads) {
    expect(up.png.subarray(0, 4).toString("hex")).toBe("89504e47");
    expect([up.png.readUInt32BE(16), up.png.readUInt32BE(20)]).toEqual([1600, 1000]);
    expect(up.meta.pose.fov_deg).toBe(50);
    // every node at the pose loaded before the timeout (C-G Task 16: the wait once starved the loads)
    expect(up.meta.render).toMatchObject({
      complete: true,
      edl: expect.any(Boolean),
      clip_box: null,
    });
  }
  expect(uploads[0].meta.pose.target).toEqual([243530, 3178050, 1]);
  // a blank read-back would be one colour
  expect(await distinctColours(page, uploads[0].png)).toBeGreaterThan(1);
});

// C-G Task 16: the capture waited on potree's node loads in a loop that never left the microtask
// queue, so a node still loading when the capture began could never finish (the chimney: 10 s, then
// `complete: false` on every view). Here the root's points are held until the capture is waiting.
test("a capture that starts while a node is loading waits for it and saves a complete view", async ({
  page,
}) => {
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 })),
  );
  let release!: () => void;
  const points = new Promise<void>((r) => (release = r));
  await page.route(
    (u) => u.pathname.endsWith(`/pointclouds/${CLOUD}/octree/octree.bin`),
    async (route) => {
      if (route.request().method() !== "OPTIONS") await points;
      return route.fallback();
    },
  );
  const uploads = await routeWorkspace(page);
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await expect
    .poll(async () => page.evaluate(() => window.__kestrelCloudViewer?.stats().nodesLoading ?? 0), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
  await startCaptureMissing(page);
  // the first capture holds the loop and waits on the held root (the page may not paint during it,
  // so the engine's own state is the signal, not the UI)
  await expect
    .poll(async () => page.evaluate(() => window.__kestrelCloudViewer?.stats().frozen ?? false), {
      timeout: 20_000,
    })
    .toBe(true);
  release();
  await expect.poll(() => uploads.length, { timeout: 30_000 }).toBe(3);
  // the wait ended on the load, not on CAPTURE_TIMEOUT_MS: every view is complete
  expect(uploads.map((u) => u.meta.render.complete)).toEqual([true, true, true]);
});

test("Cancel stops Capture missing views after the capture in flight", async ({ page }) => {
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 })),
  );
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const uploads = await routeWorkspace(page, { holdSecond: hold });
  await openSettled(page);
  await startCaptureMissing(page);
  await expect.poll(() => uploads.length, { timeout: 30_000 }).toBe(2);
  await expect(page.getByText("Saving views 1 / 3")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText(/Saving views/)).toBeHidden();
  release();
  await expect(page.getByText("Stopped after 2 of 3 report views")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(3_000);
  expect(uploads).toHaveLength(2);
});
