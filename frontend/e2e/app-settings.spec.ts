import { expect, test } from "@playwright/test";

test("Settings > Appearance reduces effects across a reload and saves the operator's name to the backend", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("radio", { name: "Reduced" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-effects", "reduced");
  await page.getByLabel("Your name").fill("Dana");
  const put = page.waitForRequest(
    (r) => r.method() === "PUT" && r.url().endsWith("/api/v1/settings/operator"),
  );
  await page.getByLabel("Your name").press("Enter");
  expect((await put).postDataJSON()).toEqual({ operator_name: "Dana" });
  await expect(page.getByText("Saved")).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-effects", "reduced");
  await expect(page.getByRole("radio", { name: "Reduced" })).toHaveAttribute("aria-checked", "true");
});
