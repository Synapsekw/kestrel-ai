import { test, expect } from "@playwright/test";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";
import { buildOctree, redGreenGrid, routeOctree } from "./fixtures/potreeOctree";
import { SWIFTSHADER_ARGS } from "./fixtures/viewer";
import { jsonReply } from "./mock";

// Final review C1: the Overview's live 3D preview must fill its pane (CloudViewer's root is `flex-1`
// and renders 0 px tall without a flex parent). Its own file: SwiftShader launch options are per file.
// Full effects, since SwiftShader makes Auto start reduced (which never mounts the live view).

const P = "7f1c2e3a-1111-4000-8000-000000000001";

test.use({ launchOptions: { args: SWIFTSHADER_ARGS } });

test("the cloud hero's 3D view fills its pane", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kestrel.effects", "full"));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/overview`,
    (route) =>
      route.fulfill(
        jsonReply({
          findings: {
            by_status: { open: 0, reviewed: 0, closed: 0 },
            open_by_severity: {},
            open_no_severity: 0,
            by_type: [],
            trend: [],
          },
          data: { image_sets: 0, images: 0, maps: 0, elevations: 0, point_clouds: 1, drawings: 0 },
          latest_volume: null,
          hero_map_id: null,
          hero: { kind: "point_cloud", id: CLOUD },
          banners: [],
        }),
      ),
  );
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson()] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 })),
  );
  await page.goto(`/p/${P}/overview`);
  const preview = page.getByRole("region", { name: "Point cloud preview" });
  const canvas = preview.getByTestId("cloud-canvas");
  await expect(canvas).toBeAttached({ timeout: 20_000 });
  await expect
    .poll(async () => (await canvas.boundingBox())?.height ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(100);
  const paneBox = (await preview.boundingBox())!;
  expect((await canvas.boundingBox())!.height).toBeGreaterThan(paneBox.height - 4);
});
