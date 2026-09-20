import { test, expect } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const DATASET = "d0000000-7777-4000-8000-000000000001";

test("lists the example dataset, opens its detail with per-class stats, and deletes it", async ({ page }) => {
  await page.goto(`/p/${P}/datasets`);
  await expect(page.getByRole("heading", { name: "Datasets" })).toBeVisible();
  const table = page.getByTestId("dataset-table");
  await expect(table).toContainText("v1");
  await expect(table).toContainText("24 / 6");

  await page.getByRole("button", { name: "Select dataset v1" }).click();
  await expect(page).toHaveURL(new RegExp(`dataset=${DATASET}`));
  const detail = page.getByTestId("dataset-detail");
  await expect(detail).toBeVisible();
  await expect(page.getByTestId("dataset-class-stats")).toContainText("excavator");
  await expect(page.getByTestId("dataset-group-stats")).toContainText("0031");
  await expect(detail).toContainText("datasets/v1");
  await expect(page.getByRole("link", { name: "Train on this dataset" })).toHaveAttribute(
    "href",
    `/p/${P}/train?dataset=${DATASET}`,
  );

  await page.getByRole("button", { name: "Delete dataset" }).click();
  await expect(page.getByText(/Delete dataset v1\?/)).toBeVisible();
  const deleted = page.waitForRequest(
    (r) => r.method() === "DELETE" && r.url().endsWith(`/datasets/${DATASET}`),
  );
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await deleted;
});

test("opens the new-dataset form and posts the create request without image_ids", async ({ page }) => {
  await page.goto(`/p/${P}/datasets`);
  await page.getByRole("button", { name: "New dataset from all labeled images" }).click();
  await page.getByLabel("Dataset name").fill("v2");
  const created = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/projects/${P}/datasets`),
  );
  await page.getByRole("button", { name: "Create dataset" }).click();
  expect((await created).postDataJSON()).toEqual({
    name: "v2",
    split_method: "by_group",
    val_fraction: 0.2,
    seed: 42,
  });
  await expect(page.getByTestId(/^job-/)).toBeVisible();
});
