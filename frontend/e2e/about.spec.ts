import { test, expect } from "@playwright/test";

test("the About screen lists every licence notice", async ({ page }) => {
  await page.goto("/about");
  const table = page.getByRole("table", { name: "Open-source components" });
  await expect(table.getByRole("row")).toHaveCount(10);
  await expect(table).toContainText("PotreeConverter");
  await expect(table).toContainText("LGPL-2.1");
});
