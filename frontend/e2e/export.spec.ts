import { test, expect } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

test("ticks YOLO on the Export screen and posts the chosen formats", async ({ page }) => {
  await page.goto(`/p/${P}/export`);
  await expect(page.getByRole("heading", { name: "Export", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Past exports" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Model for other applications" })).toBeVisible();

  await page.getByRole("checkbox", { name: /Labels in YOLO/ }).check();
  const created = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/projects/${P}/exports`),
  );
  await page.getByRole("button", { name: "Export" }).click();
  expect((await created).postDataJSON()).toEqual({
    formats: ["csv", "yolo", "html"],
    include_unreviewed: false,
  });
});
