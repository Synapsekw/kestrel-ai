import { test, expect } from "@playwright/test";

test("boots against the mock server and lists projects", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible({ timeout: 15_000 });
  // "Ahmadia" is the Project example name in openapi.yaml; exact, because the example
  // folder path "E:\Projects\Ahmadia" is rendered next to it.
  await expect(page.getByText("Ahmadia", { exact: true })).toBeVisible();
});

test("with no project open the sidebar explains itself and App settings holds the provider keys", async ({
  page,
}) => {
  await page.goto("/");
  const nav = page.getByRole("navigation");
  await expect(nav.getByText("Open or create a project to use these.")).toBeVisible();
  await nav.getByRole("link", { name: "App settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "App settings" })).toBeVisible();
  await expect(page.getByTestId("key-state-anthropic")).toHaveText("Key stored");
});
