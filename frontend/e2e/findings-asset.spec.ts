import { test, expect } from "@playwright/test";
import { entrancesDone, evidencePath } from "./evidence";
import { jsonReply } from "./mock";

// The contract's Project example, which the Prism mock serves for every project id.
const P = "7f1c2e3a-1111-4000-8000-000000000001";
const MODEL = "a0000000-9999-4000-8000-000000000001";
const T = "2026-10-02T09:00:00Z";

const model = {
  id: MODEL,
  name: "Flare stack F-1",
  asset_type: "stack",
  tag: "F-1",
  status: "ready",
  current_version: 1,
  live_run_id: null,
  captured_on: null,
  created_at: T,
  updated_at: T,
  frame: null,
  review: {
    profile_id: "stack",
    name: "Stack",
    asset_noun: "stack",
    finding_noun: "finding",
    assessment_title: "Stack assessment",
    finding_unit: "photo",
    placement: "patch",
    patch_grid: 14,
    cluster_m: 1.6,
    zones: [
      { id: "head", label: "Head", min_m: 73.6, max_m: 80 },
      { id: "shaft", label: "Shaft", min_m: 15.2, max_m: 73.6 },
      { id: "base", label: "Base", min_m: 0, max_m: 15.2 },
    ],
    sides: {
      type: "compass",
      labels: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
      basis: "position",
      title: "Side",
      noun: "side",
    },
    focus: { frustum: [4], oblique_deg: 0 },
    report: { pages: "finding", min_severity: 1 },
    component_map: [],
    facts: [],
    limits: [],
    breakdowns: [],
    footer_disclaimer: "",
  },
};

const finding = (i: number) => ({
  id: `f0000000-9999-4000-8000-0000000004${String(i).padStart(2, "0")}`,
  number: 400 + i,
  type_id: "t1",
  severity: (i % 3) + 1,
  status: "open",
  note: "",
  created_by: "human",
  confidence: null,
  anchor: { kind: "asset", asset_model_id: MODEL, asset_version: 1, point: null, normal: null },
  lon: null,
  lat: null,
  data_type: "asset_model",
  data_id: MODEL,
  created_at: T,
  updated_at: T,
  reviewed_at: null,
  closed_at: null,
  asset_model_id: MODEL,
  height_m: 10 + i,
  bearing_deg: 90,
  side: "E",
  zone: "shaft",
  component: "Shell",
  placement: "patch",
  sighting_count: 2,
  representative: { image_id: "i1", annotation_id: "b1" },
});

test("the register shows asset columns, filters by zone, has a gallery and photo outcome chips", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const list = Array.from({ length: 30 }, (_, i) => finding(i + 1));
  const queries: URLSearchParams[] = [];
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/findings`,
    (route) => {
      queries.push(new URL(route.request().url()).searchParams);
      return route.fulfill(jsonReply({ items: list, next_cursor: null }));
    },
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/asset-models`,
    (route) =>
      route.request().method() === "GET" ? route.fulfill(jsonReply({ items: [model] })) : route.fallback(),
  );

  await page.goto(`/p/${P}/findings?anchor_kind=asset`);
  await expect(page.getByRole("columnheader", { name: "Height" })).toBeVisible();
  await expect(page.getByText("11.0 m")).toBeVisible();

  // Zone filter: the model's zones are chips once a model is chosen.
  await page.getByRole("combobox", { name: "Asset model" }).selectOption(MODEL);
  await page.getByRole("group", { name: "Zone" }).getByRole("button", { name: "Shaft" }).click();
  await expect(page).toHaveURL(/zone=shaft/);
  await expect.poll(() => queries.at(-1)?.getAll("zone")).toEqual(["shaft"]);

  // Gallery: tiles, and a click opens the inspector with the view kept.
  await page.getByRole("radio", { name: "Gallery" }).click();
  await expect(page).toHaveURL(/view=gallery/);
  const gallery = page.getByRole("list", { name: "Findings gallery" });
  await expect(gallery.getByRole("listitem").first()).toBeVisible();
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("asset-findings", "register-gallery.png") });
  await gallery.getByRole("button", { name: /^F-0401 / }).click();
  await expect(page).toHaveURL(new RegExp(`/findings/${list[0].id}\\?.*view=gallery`));

  // Photo outcome chips: the image browser reads its index with the review filter.
  const indexRead = page.waitForRequest(
    (r) => r.url().includes(`/projects/${P}/images/index`) && r.url().includes("review_status=uncertain"),
  );
  await page
    .getByRole("navigation", { name: "Photo outcomes" })
    .getByRole("link", { name: "Uncertain photos" })
    .click();
  await indexRead;
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images`));
});
