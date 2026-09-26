import { test, expect } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

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
