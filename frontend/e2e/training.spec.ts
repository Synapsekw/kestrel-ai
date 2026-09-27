import { expect, test } from "@playwright/test";
import { fulfilJson, LIB_DATASET, routeDatasets, routeTraining } from "./fixtures/appSections";

test("Models > Training lists runs, shows a live run and starts a new one on a library dataset", async ({
  page,
}) => {
  await routeDatasets(page);
  await routeTraining(page);
  // The running fixture run trains on d-lib-1: its export must be ready, or Start is held back (H8).
  await page.route(
    (url) => url.pathname === "/api/v1/library/datasets",
    (route) => fulfilJson(route, { items: [{ ...LIB_DATASET, export_state: "ready" }], next_cursor: null }),
  );
  await page.goto("/models/training");
  await expect(page.getByRole("heading", { name: "Training", exact: true })).toBeVisible({ timeout: 15_000 });
  const row = page.getByRole("row", { name: /machines-v1-yolo11m-coco/ });
  await expect(row).toContainText("machines-v1");
  await row.click();
  await expect(page.getByTestId("train-progress")).toContainText("10 / 50");

  await page.goto("/models/training?new=1&dataset=d-lib-1");
  await expect(page.getByRole("heading", { name: "New training run" })).toBeVisible();
  await expect(page.getByLabel("Dataset")).toHaveValue("d-lib-1");
  await page.getByLabel("Model name").fill("machines-v2");
  const post = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/library/training-runs"),
  );
  await page.getByRole("button", { name: "Start training" }).click();
  expect((await post).postDataJSON()).toMatchObject({
    name: "machines-v2",
    dataset_id: "d-lib-1",
    epochs: 50,
    imgsz: 1280,
    patience: 50,
    augmentation: "default",
    device: "0",
  });
  await expect(page).toHaveURL(/\/models\/training\/t-2$/);
});

test("Models > Training holds Start back while a running run exports the same dataset", async ({ page }) => {
  await routeDatasets(page);
  await routeTraining(page);
  await page.goto("/models/training?new=1&dataset=d-lib-1");
  await expect(page.getByRole("heading", { name: "New training run" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Dataset")).toHaveValue("d-lib-1");
  await expect(page.getByRole("button", { name: "Start training" })).toBeDisabled();
  await expect(
    page.getByText("Dataset is being exported by another run; start when it has finished."),
  ).toBeVisible();
});
