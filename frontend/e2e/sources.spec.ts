import { test, expect } from "@playwright/test";
import { asDetectionProject, jsonReply } from "./kinds";
import { evidencePath } from "./evidence";

// The contract's examples, which the Prism mock serves: a photo batch ("Flight 15 Apr") and a map
// source ("May survey"), plus a map the Sources list links up with its source.
const P = "7f1c2e3a-1111-4000-8000-000000000001";
const PHOTOS = "50000000-3333-4000-8000-000000000001";
const MAP_SOURCE = "50000000-3333-4000-8000-000000000002";

test.beforeEach(({ page }) => asDetectionProject(page, P));

const rowOf = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(name) }) });

test("Sources lists photos and maps in one list, each with its survey date", async ({ page }) => {
  await page.goto(`/p/${P}`);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: /^Sources/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/sources$`));
  await expect(page.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();

  const photos = rowOf(page, "Flight 15 Apr");
  await expect(photos).toContainText("Photos");
  await expect(photos).toContainText("2019-04-15");
  const map = rowOf(page, "May survey");
  await expect(map).toContainText("Map");
  await expect(map).toContainText("2026-05-20");
  // A photo batch reports detections, a map objects.
  await expect(photos).toContainText("40 detections (12 verified)");
  await expect(map).toContainText("59 objects (30 verified)");
  await page.screenshot({ path: evidencePath("detection-workspace", "sources.png"), fullPage: true });

  // Run a model from a row opens Runs with that source picked. The mock's photo batch is still
  // importing, so only the map can be run yet.
  await expect(photos.getByRole("link", { name: "Run a model" })).toHaveCount(0);
  await map.getByRole("link", { name: "Run a model" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/runs\\?source=${MAP_SOURCE}$`));
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("correcting a survey date sends it and shows the saved date", async ({ page }) => {
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/sources/${PHOTOS}`,
    async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      const asked = route.request().postDataJSON() as { captured_on: string };
      return route.fulfill(
        jsonReply({
          id: PHOTOS,
          kind: "images",
          label: "Flight 15 Apr",
          captured_on: asked.captured_on,
          map_id: null,
          folder: "E:\\Dev\\Yolo\\Ahmadia Construction Data",
          site: "ahmadia",
          settings: { max_side: 4000, quality: 95, dedupe_threshold: 4 },
          image_count: 3299,
          duplicate_count: 0,
          job_id: "j0000000-4444-4000-8000-000000000001",
          imported_at: "2026-09-17T10:30:00Z",
          created_at: "2026-09-17T10:05:00Z",
        }),
      );
    },
  );
  await page.goto(`/p/${P}/sources`);
  const photos = rowOf(page, "Flight 15 Apr");
  await photos.getByRole("button", { name: "Change the survey date of Flight 15 Apr" }).click();
  await photos.getByLabel("Survey date of Flight 15 Apr").fill("2026-04-15");
  const patched = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().endsWith(`/sources/${PHOTOS}`),
  );
  await photos.getByRole("button", { name: "Save" }).click();
  expect((await patched).postDataJSON()).toEqual({ captured_on: "2026-04-15" });
  await expect(photos).toContainText("2026-04-15");
  await expect(photos).not.toContainText("2019-04-15");
});
