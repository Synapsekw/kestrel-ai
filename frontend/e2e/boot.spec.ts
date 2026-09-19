import { test, expect } from "@playwright/test";

test("boots against the mock server and lists projects", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible({ timeout: 15_000 });
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

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const IMG = "10000000-5555-4000-8000-000000000001";

test("inside a project the sidebar shows the pipeline with counts and the header names the screen", async ({
  page,
}) => {
  await page.goto(`/p/${P}`);
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link", { name: /^Images/ })).toContainText("3299");
  await expect(nav.getByRole("link", { name: /^Label/ })).toHaveAttribute("href", `/p/${P}/label`);
  await expect(nav.getByRole("link", { name: /^Review/ })).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("Home");
  await expect(page.getByTestId("home-next-step")).toBeVisible();
});

test("the Label step opens the first unlabeled image with the list as its walk", async ({ page }) => {
  await page.goto(`/p/${P}`);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: /^Label/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/edit/${IMG}$`));
  await expect(page.getByTestId("position")).toHaveText("1 / 2");
});
