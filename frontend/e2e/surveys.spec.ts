import { test, expect } from "@playwright/test";
import { asDetectionProject } from "./kinds";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

// Surveys belong to detection projects; the mock's example project is a training project.
test.beforeEach(async ({ page }) => {
  await asDetectionProject(page, P);
});

test("the surveys screen lists each survey with its change", async ({ page }) => {
  await page.goto(`/p/${P}/surveys`);
  await expect(page.getByRole("heading", { name: "Surveys", exact: true })).toBeVisible();
  const rows = page.getByRole("row");
  await expect(rows.nth(1)).toContainText("May survey");
  await expect(rows.nth(1)).toContainText("+3");
  await expect(rows.nth(2)).toContainText("April survey");
  await expect(page.getByTestId("survey-chart")).toBeVisible();
});

test("the sidebar reaches the surveys screen", async ({ page }) => {
  await page.goto(`/p/${P}/maps`);
  await page.getByRole("link", { name: "Surveys" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/surveys$`));
});
