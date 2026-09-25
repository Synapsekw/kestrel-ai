import { test, expect } from "@playwright/test";
import { asDetectionProject } from "./kinds";

// The contract's Project example, which the Prism mock serves for every project id.
const P = "7f1c2e3a-1111-4000-8000-000000000001";

test("a detection project opens the empty Point clouds and Volumes screens from the rail", async ({
  page,
}) => {
  await asDetectionProject(page, P);
  await page.goto(`/p/${P}`);
  const nav = page.getByRole("navigation", { name: "Main navigation" });

  await nav.getByRole("link", { name: "Point clouds", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/clouds$`));
  await expect(page.getByRole("heading", { name: "Point clouds" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeVisible();

  await nav.getByRole("link", { name: "Volumes", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/volumes$`));
  await expect(page.getByRole("heading", { name: "Volumes" })).toBeVisible();

  // A deep link with the 3D-jump parameters lands on the same screen.
  await page.goto(`/p/${P}/clouds/c1?at=553100.5,2847300.25`);
  await expect(page.getByRole("heading", { name: "Point clouds" })).toBeVisible();
});

test("a training project sends a Point clouds address Home", async ({ page }) => {
  await page.goto(`/p/${P}/clouds`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}$`));
});

test("App settings links to About Kestrel AI", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("link", { name: "About Kestrel AI" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { name: "About Kestrel AI" })).toBeVisible();
});
