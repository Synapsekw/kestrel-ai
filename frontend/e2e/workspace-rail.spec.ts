import { expect, test, type Page } from "@playwright/test";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";
import { SWIFTSHADER, ws } from "./fixtures/cloudWorkspace";
import {
  CRACK_ID,
  MAP_SEP,
  P,
  SITE,
  clickSite,
  enableDiagnostics,
  openMapTopic,
  serveMapWorkspace,
  type MapWorld,
} from "./fixtures/mapWorkspace";
import { buildOctree, redGreenGrid, routeOctree } from "./fixtures/potreeOctree";

// Workspace rail spec (2026-10-02) flows: the map's Findings, Measure, Drawings and AI topics, the
// `\` panel toggle, and the point cloud's Layers, Measure and Findings topics. Each test has a fresh
// browser context, so localStorage (the remembered topic) starts empty and Findings opens first.

// The cloud test draws WebGL: SwiftShader for WebGL only (a launch option, so file-wide; the map
// does not draw WebGL and is unaffected).
test.use(SWIFTSHADER);

const CORS = { "Access-Control-Allow-Origin": "*" };
const T = "2026-10-02T09:00:00Z";
/** The Prism mock's "May survey" map source (contract/openapi.yaml Source example). */
const MAP_SOURCE = "50000000-3333-4000-8000-000000000002";

test.describe("map", () => {
  test.beforeEach(async ({ page }) => {
    await enableDiagnostics(page);
  });

  async function openMaps(page: Page): Promise<MapWorld> {
    const world = await serveMapWorkspace(page);
    await page.goto(`/p/${P}/maps`);
    await expect(page.getByTestId("map-workspace")).toHaveAttribute("data-frame", "crs");
    return world;
  }

  /** F's create (not in the map fake): the finding joins the world, so the pins re-read lists it. */
  async function fakeFindingCreate(page: Page, world: MapWorld) {
    await page.route(
      (u) => u.pathname === `/api/v1/projects/${P}/findings`,
      async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        const b = route.request().postDataJSON() as { type_id: string; anchor: { geometry: unknown } };
        const f = {
          id: "f0000000-1212-4000-8000-0000000000e1",
          number: 7,
          type_id: b.type_id,
          severity: 3,
          status: "open",
          note: "",
          created_by: "user",
          confidence: null,
          anchor: { kind: "map", map_id: MAP_SEP, geometry: b.anchor.geometry },
          geometry_site: { type: "Point", coordinates: [SITE.cE, SITE.cN] },
          lon: 15.0015,
          lat: 44.995,
          data_type: "map",
          data_id: MAP_SEP,
          created_at: T,
          updated_at: T,
          reviewed_at: null,
          closed_at: null,
        };
        world.findings.push(f);
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          headers: CORS,
          body: JSON.stringify({ ...f, attachment_count: 0, comment_count: 0 }),
        });
      },
    );
  }

  test("create, list and select a finding from the Findings topic", async ({ page }) => {
    const world = await openMaps(page);
    await fakeFindingCreate(page, world);
    const findings = page.getByRole("region", { name: "Findings", exact: true });
    await expect(findings).toBeVisible();
    const add = findings.getByRole("button", { name: "Add finding point" });
    await add.click();
    await expect(add).toHaveAttribute("aria-pressed", "true");
    await clickSite(page, SITE.cE, SITE.cN);
    const picker = page.getByRole("listbox", { name: "Finding type" });
    await picker.getByRole("option", { name: /Crack/ }).click();
    await expect.poll(() => world.findings.length).toBe(1);
    expect(world.findings[0].type_id).toBe(CRACK_ID);

    const rows = findings.getByRole("listbox", { name: "Findings and zones" }).getByRole("option");
    await expect(rows).toHaveCount(1);
    // Deselect (Escape), then choose the row: the inspector opens on the finding.
    await page.keyboard.press("Escape");
    await rows.first().click();
    await expect(page.getByTestId("map-inspector")).toBeVisible();
    await expect(page.getByTestId("map-inspector")).toHaveAttribute(
      "data-sel",
      `finding:${world.findings[0].id}`,
    );
  });

  test("\\ hides and restores the panel; a tool key follows its topic", async ({ page }) => {
    await openMaps(page);
    const panel = page.getByTestId("rail-panel");
    await expect(panel).toHaveAttribute("data-topic", "findings");
    await page.keyboard.press("\\");
    await expect(panel).toHaveCount(0);
    await page.keyboard.press("\\");
    await expect(panel).toHaveAttribute("data-topic", "findings");
    await page.keyboard.press("l");
    await expect(page.getByRole("region", { name: "Measure", exact: true })).toBeVisible();
    await expect(panel).toHaveAttribute("data-topic", "measure");
  });

  test("Align lives only in the drawing inspector, not the drawing row's menu", async ({ page }) => {
    const world = await serveMapWorkspace(page);
    world.drawings.push({
      id: "d0000000-9999-4000-8000-0000000000fe",
      name: "Site plan",
      format: "dxf",
      status: "ready",
      error: null,
      georef: { method: "crs", epsg: 32633, points: [], rmse_m: null, residuals_m: [], warnings: [] },
      georef_version: 1,
      layers: [{ name: "SITE", colour: "#22d3ee", entity_count: 120, visible_default: true }],
      layer_state: {},
      captured_on: null,
    });
    await page.goto(`/p/${P}/maps`);
    await openMapTopic(page, "Drawings");
    const topic = page.locator('[data-testid="rail-panel"][data-topic="drawings"]');
    await expect(topic.getByRole("button", { name: "Import drawing" })).toBeVisible();
    await topic
      .getByRole("button", { name: /actions$/ })
      .first()
      .click();
    await expect(page.getByRole("menuitem", { name: "Properties" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Align/ })).toHaveCount(0);
  });

  test("Run on the whole map is reached from the AI topic and starts a run on the shown survey", async ({
    page,
  }) => {
    await openMaps(page);
    await openMapTopic(page, "AI");
    const run = page.getByRole("region", { name: "AI", exact: true }).getByRole("button", {
      name: "Run on the whole map",
    });
    await expect(run).toBeEnabled();
    await run.click();
    const dialog = page.getByRole("dialog", { name: "New run" });
    await expect(dialog).toBeVisible();
    // The Sep survey's map is the Prism mock's "May survey" map source (its map_id is MAP_SEP).
    await expect(dialog.getByRole("checkbox", { name: "May survey" })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: "Ortho 14 Aug" })).not.toBeChecked();
    const posted = page.waitForRequest(
      (r) => r.method() === "POST" && new URL(r.url()).pathname === `/api/v1/projects/${P}/runs`,
    );
    await dialog.getByRole("button", { name: "Start run" }).click();
    expect((await posted).postDataJSON()).toMatchObject({ source_ids: [MAP_SOURCE] });
    await expect(dialog).toBeHidden();
  });
});

test.describe("point cloud", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kestrel.diagnostics", "1"));
  });

  test("colour mode from Layers, a distance from Measure, then Findings by key", async ({ page }) => {
    const rows: Record<string, unknown>[] = [];
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
        if (req.method() === "POST") {
          const body = req.postDataJSON() as Record<string, unknown>;
          rows.push({
            id: `m${rows.length + 1}`,
            point_cloud_id: CLOUD,
            kind: body.kind,
            name: `Distance ${rows.length + 1}`,
            note: null,
            points: body.points,
            params: null,
            status: "ready",
            error: null,
            job_id: null,
            finding_id: null,
            view: null,
            created_at: T,
            updated_at: T,
            results: { distance_3d: 12.5, distance_vertical: 0, uncertainty_m: 0.04 },
          });
          return route.fulfill({
            status: 201,
            contentType: "application/json",
            headers: CORS,
            body: JSON.stringify(rows[rows.length - 1]),
          });
        }
        return route.fulfill({
          contentType: "application/json",
          headers: CORS,
          body: JSON.stringify({ items: rows }),
        });
      },
    );
    await page.goto(`/p/${P}/clouds/${CLOUD}`);
    const stats = () => page.evaluate(() => window.__kestrelCloudViewer?.stats() ?? null);
    await expect.poll(async () => (await stats())?.settledMs ?? null, { timeout: 20_000 }).not.toBeNull();
    await expect.poll(async () => (await stats())?.nodesLoading ?? 1).toBe(0);

    const w = ws(page);
    await w.openTopic("Layers");
    await expect(w.topicPanel("Layers").getByText(/Colour by/)).toBeVisible();
    await w.colour("Elevation").click();
    await expect(w.colour("Elevation")).toBeChecked();

    await page.keyboard.press("l");
    await expect(w.topicPanel("Measure")).toBeVisible();
    const box = (await w.canvas.boundingBox())!;
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.click(c.x, c.y);
    await page.mouse.click(c.x + 80, c.y);
    await expect(page.getByTestId("measure-live")).toContainText("Δz");
    await page.keyboard.press("Enter");
    await expect.poll(() => rows.length).toBe(1);
    await expect(w.measurementRow("Distance 1")).toBeVisible();

    await page.keyboard.press("m");
    await expect(w.topicPanel("Findings")).toBeVisible();
    await expect(w.railPanel).toHaveAttribute("data-topic", "findings");
  });
});
