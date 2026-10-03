import { test, expect, type Page } from "@playwright/test";
import { entrancesDone, evidencePath } from "./evidence";
import { MODEL, P, modelJson, routeAssetModels } from "./fixtures/assetModels";
import { SWIFTSHADER } from "./fixtures/cloudWorkspace";
import { jsonReply } from "./mock";

// Spec 2026-10-02-asset-findings §9 Overview: an asset project's hero is its rotating model, with the
// findings map and the photo outcome bar beside it. Full effects, since SwiftShader makes Auto start
// reduced (which never mounts the live view). Synthetic data only (Global Constraints).
test.use(SWIFTSHADER);

const T = "2026-10-02T09:00:00Z";
const frame = {
  origin: null,
  north_offset_deg: 0,
  height_m: 8,
  datum_label: "Ground",
  datum_note: "",
  line_azimuth_deg: null,
  silhouette: [
    [0, 2],
    [8, 2],
  ],
  levels: [2, 4, 6],
  presets: [],
};
const review = {
  profile_id: "tank",
  finding_unit: "region",
  placement: "patch",
  patch_grid: 14,
  cluster_m: 0.75,
  zones: [
    { id: "roof", label: "Roof", min_m: 7.6, max_m: 8 },
    { id: "shell", label: "Shell", min_m: 0.4, max_m: 7.6 },
    { id: "bottom", label: "Bottom", min_m: 0, max_m: 0.4 },
  ],
  sides: { type: "compass", labels: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], basis: "hit" },
  focus: { frustum: 2, oblique_deg: 0 },
  report: { pages: 1, min_severity: null },
};
const finding = (n: number, height: number, bearing: number, side: string, zone: string, severity: number) => ({
  id: `f0000000-9999-4000-8000-00000000050${n}`,
  number: 500 + n,
  type_id: "t1",
  severity,
  status: "open",
  note: "",
  created_by: "human",
  confidence: null,
  anchor: { kind: "asset", asset_model_id: MODEL },
  lon: null,
  lat: null,
  data_type: "asset_model",
  data_id: MODEL,
  created_at: T,
  updated_at: T,
  reviewed_at: null,
  closed_at: null,
  asset_model_id: MODEL,
  height_m: height,
  bearing_deg: bearing,
  side,
  zone,
  component: "Shell",
  placement: "patch",
  sighting_count: 1,
  representative: null,
});
const FINDINGS = [
  finding(1, 6.5, 45, "NE", "shell", 3),
  finding(2, 7.8, 200, "SW", "roof", 1),
  finding(3, 1.2, 300, "NW", "shell", 2),
];

async function serveAssetProject(page: Page) {
  await page.addInitScript(() => localStorage.setItem("kestrel.effects", "full"));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await routeAssetModels(page);
  // Registered after routeAssetModels, so it answers first for the one model read.
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/asset-models/${MODEL}`,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill(jsonReply({ ...modelJson(2), frame, review }))
        : route.fallback(),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/overview`,
    (route) =>
      route.fulfill(
        jsonReply({
          findings: {
            by_status: { open: 3, reviewed: 0, closed: 0 },
            open_by_severity: { "1": 1, "2": 1, "3": 1 },
            open_no_severity: 0,
            by_type: [],
            trend: [],
          },
          data: { image_sets: 1, images: 120, maps: 0, elevations: 0, point_clouds: 0, drawings: 0 },
          latest_volume: null,
          hero_map_id: null,
          hero: { kind: "asset_model", id: MODEL },
          banners: [],
          photo_review: { finding: 12, none: 90, uncertain: 15, not_assessed: 3 },
        }),
      ),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/findings`,
    (route) => route.fulfill(jsonReply({ items: FINDINGS, next_cursor: null })),
  );
}

test("an asset project's Overview: rotating model, findings map and outcome bar", async ({ page }) => {
  await serveAssetProject(page);
  await page.goto(`/p/${P}/overview`);

  const hero = page.getByRole("region", { name: "Asset preview" });
  await expect(hero.getByTestId("model-canvas")).toBeAttached({ timeout: 20_000 });
  await expect(hero).toHaveAttribute("data-rotating", "true", { timeout: 20_000 });
  const canvasBox = (await hero.getByTestId("model-canvas").boundingBox())!;
  expect(canvasBox.height).toBeGreaterThan((await hero.boundingBox())!.height - 4);

  const card = page.getByRole("region", { name: "Findings on the asset" });
  await expect(card.getByTestId("map-dot")).toHaveCount(3);
  await card.getByTestId("map-dot").first().hover();
  await expect(page.getByRole("tooltip")).toContainText("F-05");
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("asset-findings", "overview-asset.png") });

  const indexRead = page.waitForRequest(
    (r) => r.url().includes(`/projects/${P}/images/index`) && r.url().includes("review_status=uncertain"),
  );
  await card.getByRole("link", { name: "Uncertain: 15 photos" }).click();
  await indexRead;
});

test("a findings map dot opens the finding", async ({ page }) => {
  await serveAssetProject(page);
  await page.goto(`/p/${P}/overview`);
  const card = page.getByRole("region", { name: "Findings on the asset" });
  await expect(card.getByTestId("map-dot")).toHaveCount(3);
  await card.getByTestId("map-dot").first().click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/findings/f0000000-9999-4000-8000-00000000050\\d$`));
});
