import { test, expect } from "@playwright/test";
import { asDetectionProject } from "./kinds";
import { evidencePath } from "./evidence";

// The contract's examples: two surveys (April 12 excavators, 9 verified; May 15, all verified), two
// site areas and one photo batch ("Flight 15 Apr": 31 excavators, 12 verified).
const P = "7f1c2e3a-1111-4000-8000-000000000001";

test.beforeEach(({ page }) => asDetectionProject(page, P));

test("Analytics shows totals with verified counts, and Verified only switches to verified", async ({
  page,
}) => {
  await page.goto(`/p/${P}`);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: /^Analytics/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/analytics$`));
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();

  const surveys = page.getByTestId("surveys-table");
  await expect(surveys).toContainText("12 (9 verified)");
  const photos = page.getByTestId("photo-section");
  const batch = photos.getByRole("row").filter({ hasText: "Flight 15 Apr" });
  await expect(batch).toContainText("31 (12 verified)");
  // Photo batches report detections, never objects.
  await expect(photos).toContainText(
    "Detections in photos (not object counts: the same object appears in several photos)",
  );
  await expect(page.getByTestId("area-table")).toContainText("North laydown yard");
  await page.screenshot({ path: evidencePath("detection-workspace", "analytics.png"), fullPage: true });

  const verifiedOnly = page.waitForRequest(
    (r) => r.url().includes(`/projects/${P}/survey-timeline`) && r.url().includes("verified_only=true"),
  );
  await page.getByRole("switch", { name: "Verified only" }).click();
  await verifiedOnly;
  await expect(page.getByTestId("surveys-section")).toContainText("Verified objects in each survey");
  await expect(surveys).not.toContainText("(9 verified)");
  await expect(batch).toContainText("12");
  await expect(batch).not.toContainText("31");
});
