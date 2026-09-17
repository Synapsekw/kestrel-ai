import { test, expect } from "@playwright/test";

test("boots against the mock server and lists projects", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible({ timeout: 15_000 });
  // "Ahmadia" is the Project example name in openapi.yaml; exact, because the example
  // folder path "E:\Projects\Ahmadia" is rendered next to it.
  await expect(page.getByText("Ahmadia", { exact: true })).toBeVisible();
});
