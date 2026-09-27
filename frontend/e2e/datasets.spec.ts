import { expect, test } from "@playwright/test";
import { routeDatasets } from "./fixtures/appSections";

test("Models > Datasets lists a dataset built across projects, opens it, exports and deletes it", async ({
  page,
}) => {
  await routeDatasets(page);
  await page.goto("/models/datasets");
  await expect(page.getByRole("heading", { name: "Datasets", exact: true })).toBeVisible({ timeout: 15_000 });
  const row = page.getByRole("row", { name: /machines-v1/ });
  await expect(row).toContainText("Ahmadia");
  await expect(row).toContainText("24 / 6");

  await row.click();
  await expect(page).toHaveURL(/\/models\/datasets\/d-lib-1$/);
  await expect(page.getByTestId("dataset-classes")).toContainText("Dump truck");
  await expect(page.getByRole("link", { name: "Train on this dataset" })).toHaveAttribute(
    "href",
    "/models/training?new=1&dataset=d-lib-1",
  );

  const exported = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/datasets/d-lib-1/export"));
  await page.getByRole("button", { name: "Build export" }).click();
  await exported;

  await page.getByRole("button", { name: "Delete dataset" }).click();
  const deleted = page.waitForRequest((r) => r.method() === "DELETE" && r.url().endsWith("/datasets/d-lib-1"));
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await deleted;
  await expect(page).toHaveURL(/\/models\/datasets$/);
});
