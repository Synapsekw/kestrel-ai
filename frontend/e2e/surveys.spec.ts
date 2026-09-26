import { test, expect } from "@playwright/test";
import { asDetectionProject } from "./kinds";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

// Surveys belong to detection projects; the mock's example project is a training project.
test.beforeEach(async ({ page }) => {
  await asDetectionProject(page, P);
});

test("the survey timeline lives in Analytics, and its old address still opens it", async ({ page }) => {
  await page.goto(`/p/${P}/surveys`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/analytics$`));
  const section = page.getByTestId("surveys-section");
  await expect(section.getByRole("heading", { name: "Surveys", exact: true })).toBeVisible();
  const rows = section.getByRole("row");
  await expect(rows.nth(1)).toContainText("May survey");
  await expect(rows.nth(1)).toContainText("+3");
  await expect(rows.nth(2)).toContainText("April survey");
  await expect(section.getByTestId("survey-chart")).toBeVisible();
});

test("a detection project has no separate Surveys entry any more", async ({ page }) => {
  await page.goto(`/p/${P}/sources`);
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: /^Analytics/ })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Surveys" })).toHaveCount(0);
});
