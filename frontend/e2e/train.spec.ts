import { test, expect } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const MODEL = "m0000000-2222-4000-8000-000000000001";
const DATASET = "d0000000-7777-4000-8000-000000000001";
const JOB = "j0000000-4444-4000-8000-000000000001";

test("starts training with the chosen parameters and shows the live card with log and cancel", async ({
  page,
}) => {
  await page.goto(`/p/${P}/train`);
  await expect(page.getByRole("heading", { name: "Train" })).toBeVisible();
  await expect(page.getByLabel("Dataset")).toHaveValue(DATASET);
  await expect(page.getByLabel("Base model")).toHaveValue(MODEL);
  await expect(page.getByLabel("Model name")).toHaveValue("v1-yolo11m-coco");
  await expect(page.getByRole("link", { name: "Create dataset" })).toHaveAttribute(
    "href",
    `/p/${P}/datasets`,
  );
  await page.getByLabel("Model name").fill("ahmadia-v1-n");
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByLabel("Epochs").fill("3");
  await page.getByLabel("Augmentation").selectOption("aerial");
  await page.getByLabel("Automatic batch size").uncheck();
  await page.getByLabel("Batch size", { exact: true }).fill("8");
  const post = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/projects/${P}/models/train`),
  );
  await page.getByRole("button", { name: "Start training" }).click();
  expect((await post).postDataJSON()).toEqual({
    name: "ahmadia-v1-n",
    dataset_id: DATASET,
    base_model_id: MODEL,
    epochs: 3,
    imgsz: 1280,
    batch: 8,
    patience: 50,
    augmentation: "aerial",
    device: "0",
  });
  await expect(page).toHaveURL(new RegExp(`job=${JOB}`));
  const card = page.getByTestId("train-progress");
  await expect(card).toBeVisible();
  // The mock answers with its example job (an import at 42 %): no epoch in the message, hence the dash.
  await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  await expect(card.getByTestId("epoch")).toHaveText("–");
  await expect(card.getByTestId("elapsed")).not.toHaveText("–");
  await card.getByRole("button", { name: "Show log" }).click();
  await expect(card.getByTestId("jobcard-log")).toContainText("job started");
  await expect(page.getByText(/1 active job/)).toBeVisible();
  const cancel = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/jobs/${JOB}/cancel`));
  await card.getByRole("button", { name: "Cancel job" }).click();
  await cancel;
  await page.getByRole("button", { name: "New training" }).click();
  await expect(page.getByRole("button", { name: "Start training" })).toBeVisible();
});

test("validation blocks an empty name and a 501 trainer shows the note", async ({ page }) => {
  await page.route(
    (url) => url.pathname.endsWith(`/projects/${P}/models/train`),
    (route) =>
      route.fulfill({
        status: 501,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: { code: "not_implemented", message: "training arrives with S3", details: {} },
        }),
      }),
  );
  await page.goto(`/p/${P}/train`);
  await expect(page.getByLabel("Dataset")).toHaveValue(DATASET);
  await page.getByLabel("Model name").fill("");
  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByRole("alert")).toContainText("Give the model a name.");
  await page.getByLabel("Model name").fill("x");
  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByRole("note")).toContainText("Training is not available yet");
  await expect(page.getByRole("button", { name: "Start training" })).toBeEnabled();
});
