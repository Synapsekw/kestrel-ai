import { test, expect } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

test("the old Export address opens Reports → Data exports and posts the chosen formats", async ({ page }) => {
  await page.goto(`/p/${P}/export`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/reports/exports$`));
  const panel = page.getByRole("region", { name: "Data exports" });
  await expect(panel).toBeVisible();
  await expect(page.getByRole("radio", { name: "Data exports" })).toBeChecked();
  await expect(panel.getByRole("heading", { name: "Past exports" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Model for other applications" })).toHaveCount(0);
  await expect(panel.getByRole("checkbox", { name: /Image contact sheet \(HTML\)/ })).toBeChecked();

  await panel.getByRole("checkbox", { name: /Labels in YOLO/ }).check();
  const created = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/projects/${P}/exports`),
  );
  // The counts export has its own "Export" button; this is the results form's.
  await panel
    .getByRole("region", { name: "Results" })
    .getByRole("button", { name: "Export", exact: true })
    .click();
  expect((await created).postDataJSON()).toEqual({
    formats: ["csv", "yolo", "html"],
    include_unreviewed: false,
  });
});
