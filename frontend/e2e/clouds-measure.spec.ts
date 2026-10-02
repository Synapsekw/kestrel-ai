import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";
import { ws } from "./fixtures/cloudWorkspace";
import { buildOctree, redGreenGrid, routeOctree } from "./fixtures/potreeOctree";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const CORS = { "Access-Control-Allow-Origin": "*" };

// WebGL on SwiftShader for WebGL only (vault/decisions/2026-09-26-gotcha-swiftshader-compositing.md).
test.use({ launchOptions: { args: ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"] } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kestrel.diagnostics", "1"));
});

async function viewerSettled(page: Page) {
  const stats = () => page.evaluate(() => window.__kestrelCloudViewer?.stats() ?? null);
  await expect.poll(async () => (await stats())?.settledMs ?? null, { timeout: 20_000 }).not.toBeNull();
  await expect.poll(async () => (await stats())?.nodesLoading ?? 1).toBe(0);
}

const row = (o: Record<string, unknown>) => ({
  point_cloud_id: CLOUD,
  note: null,
  params: null,
  status: "ready",
  error: null,
  job_id: null,
  finding_id: null,
  view: null,
  created_at: "2026-09-27T10:00:00Z",
  updated_at: "2026-09-27T10:00:00Z",
  results: {},
  ...o,
});

const job = {
  id: "j0000000-4444-4000-8000-00000000c0m1",
  project_id: P,
  type: "pointcloud_profile",
  state: "queued",
  progress: 0,
  message: "",
  log_path: "runs/j0000000-4444-4000-8000-00000000c0m1/job.log",
  params: { cloud_id: CLOUD, measurement_id: "m1" },
  result: null,
  error: null,
  created_at: "2026-09-27T10:00:00Z",
  started_at: null,
  finished_at: null,
};

/** The fixture cloud and octree, a measurement list the test owns, and the events socket. */
async function setup(page: Page) {
  const state = {
    rows: [] as Record<string, unknown>[],
    posts: [] as Record<string, unknown>[],
    socket: null as WebSocketRoute | null,
  };
  await page.routeWebSocket(/\/api\/v1\/events/, (ws) => {
    state.socket = ws;
  });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson()] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 })),
  );
  await page.route(
    (u) => u.pathname.endsWith(`/pointclouds/${CLOUD}/measurements`),
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST")
        return route.fulfill({
          contentType: "application/json",
          headers: CORS,
          body: JSON.stringify({ items: state.rows }),
        });
      const body = req.postDataJSON() as Record<string, unknown>;
      state.posts.push(body);
      const n = state.rows.length + 1;
      if (body.kind === "profile") {
        const m = row({
          id: `m${n}`,
          kind: "profile",
          name: `Cross-section ${n}`,
          points: body.points,
          params: body.params,
          status: "computing",
          job_id: job.id,
        });
        state.rows.push(m);
        return route.fulfill({
          status: 202,
          contentType: "application/json",
          headers: CORS,
          body: JSON.stringify({ measurement: m, job }),
        });
      }
      const area = body.kind === "area";
      const m = row({
        id: `m${n}`,
        kind: body.kind,
        name: `${area ? "Area" : "Distance"} ${n}`,
        points: body.points,
        params: body.params ?? null,
        results: area
          ? { area_m2: 12.5, area_surface_m2: 12.5, area_plan_m2: 12.5, plane_rms_m: 0 }
          : { distance_3d: 12.5, distance_vertical: 0, uncertainty_m: 0.04 },
      });
      state.rows.push(m);
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify(m),
      });
    },
  );
  return state;
}

async function centre(page: Page) {
  const box = (await page.getByTestId("cloud-canvas").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("area: four picks and Enter save the outline with its mode (spec §15 e2e 5)", async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);
  await page.keyboard.press("q");
  // Ruling P-R10a: W1's HintBar renders ENTRY.area.hint in its own span, outside M1's measure-hint
  // node, so this asserts on the hint bar itself.
  await expect(page.getByTestId("cloud-hintbar")).toContainText("Click to add vertices");
  const c = await centre(page);
  for (const [dx, dy] of [
    [-60, -40],
    [60, -40],
    [60, 40],
    [-60, 40],
  ])
    await page.mouse.click(c.x + dx, c.y + dy);
  await expect(page.getByTestId("measure-hint")).toContainText("4 vertices");
  await page.keyboard.press("Enter");
  await expect.poll(() => state.posts.length).toBe(1);
  const body = state.posts[0] as { kind: string; points: unknown[]; params: { mode: string } };
  expect(body.kind).toBe("area");
  expect(body.points).toHaveLength(4);
  expect(body.params.mode).toBe("surface");
  await ws(page).openTopic("Measure"); // the list lives in the rail (workspace-rail spec §3.2)
  await expect(
    page.getByRole("list", { name: "Saved measurements" }).getByRole("button", { name: /Area 1/ }),
  ).toContainText("12.50 m²");
});

test("cross-section: preview, Save answers 202, then Full resolution on pointclouds.changed (spec §15 e2e 6)", async ({
  page,
}) => {
  const state = await setup(page);
  await page.route(
    (u) => u.pathname.endsWith(`/pointclouds/${CLOUD}/measurements/m1/profile`),
    (route) =>
      route.fulfill({
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify({
          s: [0, 1, 2],
          z: [0, 0.5, 0],
          rgb: null,
          count: 3,
          thickness_m: 0.2,
          length_m: 2,
        }),
      }),
  );
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);
  await expect.poll(() => state.socket !== null).toBe(true);
  await page.keyboard.press("e");
  const c = await centre(page);
  await page.mouse.click(c.x - 80, c.y);
  await page.mouse.click(c.x + 80, c.y);
  await expect(page.getByTestId("profile-panel")).toBeVisible();
  // The preview comes from the displayed points; a 0.2 m slab across the 1 m fixture grid can miss
  // every row, and then the panel says so instead of drawing an empty chart.
  await expect(page.getByTestId("profile-caption")).toHaveText(
    /^(Preview · display points|No points in this slab; widen the thickness)$/,
  );
  await page.getByTestId("cloud-hintbar").getByRole("button", { name: /^Save/ }).click();
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0]).toMatchObject({ kind: "profile", params: { thickness_m: 0.2 } });
  const pts = state.posts[0].points as { z: number }[];
  expect(pts[1].z).toBe(pts[0].z);
  await ws(page).openTopic("Measure"); // the list lives in the rail (workspace-rail spec §3.2)
  await expect(page.getByRole("button", { name: /Cross-section 1/ })).toContainText("Cutting the profile…");
  state.rows[0] = {
    ...state.rows[0],
    status: "ready",
    updated_at: "2026-09-27T10:01:00Z",
    results: { profile_length_m: 2, profile_point_count: 3 },
  };
  state.socket!.send(
    JSON.stringify({
      type: "pointclouds.changed",
      project_id: P,
      job_id: null,
      progress: 0,
      message: "",
      payload: { cloud_ids: [CLOUD] },
    }),
  );
  await expect(page.getByTestId("profile-caption")).toHaveText("Full resolution · 3 points");
});

test("distance: two picks and Enter, the 3D label, then Copy all as CSV with the export's columns", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const state = await setup(page);
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);
  await page.keyboard.press("l");
  const c = await centre(page);
  await page.mouse.click(c.x, c.y);
  await page.mouse.click(c.x + 80, c.y);
  // Ruling P-R10b: sub-metre picks print cm/mm (formatLength), so assert "Δz" (always in the
  // distance headline) instead of " m".
  await expect(page.getByTestId("measure-live")).toContainText("Δz");
  await expect(page.getByTestId("measure-label")).toBeVisible();
  expect(await page.evaluate(() => window.__kestrelCloudViewer!.overlays())).toContain("measure");
  await page.keyboard.press("Enter");
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0]).toMatchObject({ kind: "distance" });
  await ws(page).openTopic("Measure"); // the list lives in the rail (workspace-rail spec §3.2)
  await expect(page.getByRole("button", { name: /Distance 1/ })).toBeVisible();
  await page.getByRole("button", { name: "Copy all as CSV" }).click();
  const csv = await page.evaluate(() => navigator.clipboard.readText());
  expect(csv.split("\r\n")[0]).toBe(
    "id,name,kind,note,x1,y1,z1,u1,x2,y2,z2,u2,lon,lat,dx,dy,dz,distance_3d,distance_horizontal,distance_vertical,height_difference,lean_offset_m,lean_angle_deg,lean_azimuth_deg,lean_mm_per_m,uncertainty_m,angle_uncertainty_deg,vertex_count,geometry_wkt,area_m2,area_surface_m2,area_plan_m2,perimeter_m,plane_rms_m,plane_tilt_deg,plane_azimuth_deg,uncertainty_m2,ring_radius_lower_m,ring_radius_upper_m,ring_rms_lower_m,ring_rms_upper_m,profile_length_m,profile_z_min,profile_z_max,profile_width_max_m,profile_point_count",
  );
});
