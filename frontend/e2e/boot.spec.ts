import { test, expect } from "@playwright/test";

test("boots against the mock server and lists projects", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible({ timeout: 15_000 });
  // "Ahmadia" is the Project example name in openapi.yaml; exact, because the example
  // folder path "E:\Projects\Ahmadia" is rendered next to it.
  await expect(page.getByText("Ahmadia", { exact: true })).toBeVisible();
});

test("with no project open the rail reaches App settings, which holds the provider keys", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "App settings" })).toBeVisible();
  await expect(page.getByTestId("key-state-anthropic")).toHaveText("Key stored");
});

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const IMG = "10000000-5555-4000-8000-000000000001";

test("a project opens on Overview with counts in the tabs", async ({ page }) => {
  await page.goto(`/p/${P}`);
  await expect(page).toHaveURL(/overview$/);
  await expect(page.getByRole("tablist").getByRole("tab", { name: /^Images/ })).toContainText(/\d/);
  await expect(page.getByRole("banner")).toContainText("Overview");
});

test("Label next in the top bar opens an image in the workspace", async ({ page }) => {
  await page.goto(`/p/${P}/images`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images/[^/?]+$`));
  await page.getByRole("button", { name: "Label next" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images/${IMG}$`));
  await expect(page.getByTestId("images-status-bar")).toContainText(/Image\s+\d+\s*\/\s*\d+/);
});
