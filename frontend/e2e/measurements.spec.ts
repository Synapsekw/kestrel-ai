import { test, expect } from "@playwright/test";
import { jsonReply } from "./mock";

// The Measurements tab (M-W6) against the Prism mock; the union list is answered by page.route so
// the rows (one per provider, plus a sub-kind the client does not know) are fixed.
const P = "7f1c2e3a-1111-4000-8000-000000000001";
const MAP_M = "e0000000-1212-4000-8000-000000000001";
const VOL_M = "e0000000-1212-4000-8000-000000000003";
const CLOUD = "c0000000-8888-4000-8000-000000000001";

const row = (over: Record<string, unknown>) => ({
  kind: "map",
  sub_kind: "distance",
  id: MAP_M,
  name: "Fence line",
  headline: 12.5,
  unit: "m",
  data_type: "map",
  data_id: "a0000000-6666-4000-8000-000000000001",
  status: "ready",
  updated_at: "2026-09-27T10:00:00Z",
  ...over,
});
const ROWS = [
  row({}),
  row({
    kind: "volume",
    sub_kind: "volume",
    id: VOL_M,
    name: "Pile 1",
    headline: 1234.5,
    unit: "m3",
  }),
  row({
    kind: "cloud",
    sub_kind: "slope_angle",
    id: "e0000000-1212-4000-8000-000000000004",
    name: "Slope A",
    headline: null,
    unit: null,
    data_type: "point_cloud",
    data_id: CLOUD,
    status: "computing",
  }),
];

test("the Measurements tab lists every kind and opens each where it was measured", async ({ page }) => {
  const kinds: (string | null)[] = [];
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/measurements`,
    (r) => {
      const kind = new URL(r.request().url()).searchParams.get("kind");
      kinds.push(kind);
      return r.fulfill(
        jsonReply({
          items: kind ? ROWS.filter((x) => x.kind === kind) : ROWS,
          next_cursor: null,
        }),
      );
    },
  );
  await page.goto(`/p/${P}/measurements`);
  await expect(page.getByRole("heading", { level: 1, name: "Measurements" })).toBeVisible({
    timeout: 15_000,
  });
  const grid = page.getByRole("grid", { name: "Measurements" });
  await expect(grid.getByRole("row").filter({ hasText: "Fence line" })).toContainText("12.5 m");
  await expect(grid.getByRole("row").filter({ hasText: "Slope A" })).toContainText(
    "Point cloud · Slope angle",
  );
  await expect(grid.getByRole("row").filter({ hasText: "Slope A" })).toContainText("—");

  await page.getByRole("radio", { name: "Maps" }).click();
  await expect(page).toHaveURL(/\/measurements\?kind=map$/);
  await expect(grid.getByRole("row").filter({ hasText: "Pile 1" })).toHaveCount(0);
  expect(kinds).toContain("map");
  await page.getByRole("radio", { name: "All" }).click();

  await grid.getByRole("row").filter({ hasText: "Pile 1" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/measurements/volumes/${VOL_M}$`));
  await page.goBack();

  await grid.getByRole("row").filter({ hasText: "Fence line" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/maps\\?sel=measurement:${MAP_M}$`));
});

test("an old volume address still opens the volume view", async ({ page }) => {
  await page.goto(`/p/${P}/measurements/${VOL_M}`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/measurements/volumes/${VOL_M}$`));
});
