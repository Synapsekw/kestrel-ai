import { test, expect, type Page } from "@playwright/test";
import { entrancesDone, evidencePath } from "./evidence";
import { jsonReply } from "./mock";

// The contract's Project example, which the Prism mock serves for every project id.
const P = "7f1c2e3a-1111-4000-8000-000000000001";

const finding = {
  id: "f0000000-9999-4000-8000-000000000217",
  number: 217,
  type_id: "t1",
  severity: 4,
  status: "open",
  note: "",
  created_by: "human",
  confidence: null,
  anchor: { kind: "image", image_id: "i1", annotation_id: "b1" },
  lon: null,
  lat: null,
  data_type: "image_set",
  data_id: "s1",
  created_at: "2026-09-14T09:00:00Z",
  updated_at: "2026-09-14T11:06:00Z",
  reviewed_at: null,
  closed_at: null,
};

async function serveFindings(page: Page) {
  const list = Array.from({ length: 60 }, (_, i) => ({ ...finding, id: `f-${i}`, number: 300 - i }));
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/findings`,
    (route) => route.fulfill(jsonReply({ items: [finding, ...list], next_cursor: null })),
  );
  // The inspector's detail read, so it shows the same finding as the row (Prism would answer its example).
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/findings/${finding.id}`,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill(jsonReply({ ...finding, attachment_count: 0, comment_count: 0 }))
        : route.fallback(),
  );
}

test("the Overview renders its blocks and a severity bar filters the Findings tab", async ({ page }) => {
  await serveFindings(page);
  await page.goto(`/p/${P}/overview`);
  await expect(page.getByText("Open findings", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent findings" })).toBeVisible();
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("foundation-s1", "overview.png"), fullPage: true });
  const bar = page.getByRole("link", { name: /: \d+ open$/ }).first();
  await bar.click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/findings\\?status=open&severity=\\d`));
  await expect(page.getByRole("radio", { name: /^Open/ })).toHaveAttribute("aria-checked", "true");
});

test("the Findings tab lists rows, opens the inspector and closes it with Esc", async ({ page }) => {
  await serveFindings(page);
  await page.goto(`/p/${P}/findings`);
  await expect(page.getByText("F-0217")).toBeVisible();
  // DataTable opens a row on a single click (or Enter).
  await page.getByText("F-0217").click();
  await expect(page).toHaveURL(new RegExp(`/findings/${finding.id}$`));
  await expect(page.getByText("Selected finding")).toBeVisible();
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("foundation-s1", "findings-inspector.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(new RegExp(`/p/${P}/findings$`));
});

test("Add data offers five tiles and opens the map importer", async ({ page }) => {
  await page.goto(`/p/${P}/overview`);
  await page.getByRole("button", { name: "Add data" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add data" });
  for (const name of ["Photos", "Orthomosaic", "Elevation", "Point cloud", "Drawing"]) {
    await expect(dialog.getByRole("button", { name: new RegExp(name) })).toBeEnabled();
  }
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("foundation-s1", "add-data.png") });
  await dialog.getByRole("button", { name: /Orthomosaic/ }).click();
  await expect(page.getByRole("dialog", { name: /map/i })).toBeVisible();
});
