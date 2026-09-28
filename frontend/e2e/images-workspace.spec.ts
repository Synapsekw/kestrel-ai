import { test, expect, type Page } from "@playwright/test";
import { jsonReply } from "./mock";

// The Images workspace (I-FW): the routes that land in it, and the arrivals from a cloud and from
// a finding. The workspace's own reads are answered here; FC/FB/FA reads fall through to Prism.

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const IMG = "10000000-5555-4000-8000-000000000001";
const IMG2 = "10000000-5555-4000-8000-000000000002";
const CLOUD = "c0000000-8888-4000-8000-000000000001";
const FINDING = "f0000000-9999-4000-8000-000000000217";
/** The contract's Box example id, which Prism serves as `IMG`'s box. */
const BOX = "b0000000-6666-4000-8000-000000000001";

const camera = {
  rel_alt: 38.4,
  gimbal_pitch: -90,
  gimbal_yaw: 0,
  focal_mm: 12.3,
  focal_px: null,
  sensor_w_mm: 17.3,
  lrf_distance_m: null,
  subject_distance_m: null,
  distance_m: 38.4,
  distance_sigma_m: 1,
  distance_source: "rel_alt",
  gsd_mm: 1.8,
  camera_model: "M3E",
};
const image = (id: string) => ({
  id,
  path: `images/${id}.jpg`,
  file_name: `${id.slice(-4)}.jpg`,
  width: 4000,
  height: 2667,
  source_id: "s1",
  group_key: "",
  capture_time: null,
  lat: null,
  lon: null,
  alt: null,
  phash: null,
  box_count: 1,
  pending_count: 0,
  max_pending_confidence: null,
  labeled: true,
  marked_empty: false,
  created_at: "2026-09-27T00:00:00Z",
  finding_count: 1,
  worst_severity: 4,
  reviewed: true,
  camera,
  footprint: null,
  footprint_kind: "none",
});

/** Answers the workspace's own reads; FC/FB/FA reads fall through to the Prism mock. */
async function world(page: Page) {
  const api = `**/api/v1/projects/${P}`;
  await page.route(`${api}/images/index*`, (r) =>
    r.fulfill(
      jsonReply({
        total: 2,
        ids: [IMG, IMG2],
        sev: [4, 0],
        count: [1, 0],
        flags: [1, 0],
        lon: [null, null],
        lat: [null, null],
      }),
    ),
  );
  await page.route(new RegExp(`/api/v1/projects/${P}/images/(${IMG}|${IMG2})$`), (r) =>
    r.fulfill(jsonReply(image(r.request().url().endsWith(IMG) ? IMG : IMG2))),
  );
  await page.route(`${api}/findings/${FINDING}`, (r) =>
    r.fulfill(
      jsonReply({
        id: FINDING,
        number: 217,
        type_id: "t1",
        severity: 4,
        status: "open",
        note: "",
        created_by: "human",
        confidence: null,
        anchor: { kind: "image", image_id: IMG, annotation_id: BOX },
        lon: null,
        lat: null,
        data_type: "image_set",
        data_id: "s1",
        created_at: "2026-09-27T00:00:00Z",
        updated_at: "2026-09-27T00:00:00Z",
        reviewed_at: null,
        closed_at: null,
        attachment_count: 0,
        comment_count: 0,
      }),
    ),
  );
  await page.route(`${api}/pointclouds`, (r) => r.fulfill(jsonReply({ items: [] })));
}

test("the Images tab lands on its first image; /review and /query land in the workspace", async ({ page }) => {
  await world(page);
  await page.goto(`/p/${P}/images`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images/${IMG}$`));
  await expect(page.getByTestId("images-status-bar")).toContainText(/Image\s+1\s*\/\s*2/);
  await expect(page.getByTestId("image-info-chip")).toContainText("GSD 1.8 mm/px");
  await page.goto(`/p/${P}/review`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images/${IMG}$`));
  await page.goto(`/p/${P}/query`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images(/[^?]+)?$`));
  await page.goto(`/p/${P}/label`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images/[^?]+$`));
  await page.goto(`/p/${P}/edit/${IMG2}`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images/${IMG2}$`));
});

test("a cloud arrival centres a static ring, offers Back to 3D and leaves a clean URL", async ({ page }) => {
  await world(page);
  await page.goto(`/p/${P}/images/${IMG}?at=2000,1300&r=40&from=cloud:${CLOUD}`);
  const marker = page.getByTestId("arrival-marker");
  await expect(marker).toHaveAttribute("data-at", "2000,1300");
  await expect(marker).toHaveAttribute("data-r", "40");
  await expect(page.getByRole("link", { name: "Back to 3D" })).toHaveAttribute(
    "href",
    `/p/${P}/clouds/${CLOUD}`,
  );
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images/${IMG}$`));
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Escape");
  await expect(marker).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to 3D" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images/${IMG2}$`));
  await expect(page.getByRole("link", { name: "Back to 3D" })).toHaveCount(0);
});

test("a finding link on another image opens the finding's image with its inspector", async ({ page }) => {
  await world(page);
  await page.goto(`/p/${P}/images/${IMG2}?finding=${FINDING}`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images/${IMG}$`));
  await expect(page.getByTestId("inspector-column")).toContainText("F-0217");
});
