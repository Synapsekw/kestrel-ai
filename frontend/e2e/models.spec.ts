import { test, expect, type Route } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const MODEL = "m0000000-2222-4000-8000-000000000001";
const TRAINED = "m0000000-2222-4000-8000-000000000002";
const DATASET = "d0000000-7777-4000-8000-000000000001";

const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  headers: { "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(body),
});

const trained = {
  id: TRAINED,
  name: "ahmadia-v1-n",
  kind: "trained",
  weights_path: "models/ahmadia-v1-n.pt",
  base_weights: "yolo11n.pt",
  dataset_id: DATASET,
  hyperparameters: { epochs: 3, imgsz: 1280 },
  metrics: {
    map50: 0.71,
    map50_95: 0.44,
    precision: 0.78,
    recall: 0.66,
    per_class: [{ class_name: "excavator", map50: 0.8, map50_95: 0.5, precision: 0.82, recall: 0.7 }],
  },
  class_names: ["excavator", "dump_truck"],
  class_aliases: {},
  exports: { onnx: "models/ahmadia-v1-n.onnx" },
  artifacts: {
    results_csv: "runs/j1/results.csv",
    confusion_matrix: "runs/j1/cm.png",
    pr_curve: "runs/j1/pr.png",
  },
  run_id: null,
  created_at: "2026-09-17T15:00:00Z",
};

const importedModel = {
  id: MODEL,
  name: "yolo11m-coco",
  kind: "imported",
  weights_path: "models/yolo11m.pt",
  base_weights: null,
  dataset_id: null,
  hyperparameters: {},
  metrics: null,
  class_names: ["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck"],
  class_aliases: { truck: "dump_truck" },
  exports: {},
  artifacts: {},
  run_id: null,
  created_at: "2026-09-17T10:10:00Z",
};

const CSV = [
  "epoch,time,metrics/precision(B),metrics/recall(B),metrics/mAP50(B),metrics/mAP50-95(B)",
  "1,12.3,0.31,0.22,0.18,0.09",
  "2,24.1,0.52,0.41,0.45,0.24",
  "3,36.0,0.78,0.66,0.71,0.44",
].join("\n");

const isModelsList = (url: URL) => url.pathname === `/api/v1/projects/${P}/models`;

test("lists the registry and opens the imported model's detail from the table", async ({ page }) => {
  await page.goto(`/p/${P}/models`);
  await expect(page.getByRole("heading", { name: "Models" })).toBeVisible();
  await expect(page.getByTestId("model-table")).toContainText("yolo11m-coco");
  await expect(page.getByTestId("model-table")).toContainText("Imported");
  await page.getByRole("button", { name: "Select model yolo11m-coco" }).click();
  await expect(page).toHaveURL(new RegExp(`model=${MODEL}`));
  const detail = page.getByTestId("model-detail");
  await expect(detail).toContainText("dump_truck");
  await expect(detail).toContainText("No training artifacts (imported weights).");
  await expect(detail).toContainText("Pre-annotation model");
});

test("a trained model shows metrics, the per-class table, the curve from results.csv and the artifact images", async ({
  page,
}) => {
  await page.route(isModelsList, (route: Route) =>
    route.fulfill(json({ items: [trained], next_cursor: null })),
  );
  await page.route(
    (url) => url.pathname.endsWith(`/models/${TRAINED}/artifacts/results_csv`),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/csv",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: CSV,
      }),
  );
  const cm = page.waitForRequest((r) =>
    r.url().includes(`/models/${TRAINED}/artifacts/confusion_matrix?token=mock`),
  );
  await page.goto(`/p/${P}/models?model=${TRAINED}`);
  await cm;
  const row = page.getByRole("button", { name: "Select model ahmadia-v1-n" }).locator("xpath=ancestor::tr");
  await expect(row).toContainText("71.0%");
  await expect(row).toContainText("v1");
  await expect(page.getByTestId("class-metrics")).toContainText("excavator");
  await expect(page.getByTestId("training-curve")).toHaveAttribute("data-points", "3");
  await expect(page.getByText("Confusion matrix", { exact: true })).toBeVisible();
  await expect(page.getByText("PR curve", { exact: true })).toBeVisible();
  await expect(page.getByText("models/ahmadia-v1-n.onnx")).toBeVisible();
});

test("export, import, use as pre-annotation and delete send the contract requests", async ({ page }) => {
  // Both models are listed so the imported one (the mock's answer to the import) has a detail to delete.
  await page.route(isModelsList, (route: Route) =>
    route.fulfill(json({ items: [trained, importedModel], next_cursor: null })),
  );
  await page.goto(`/p/${P}/models?model=${TRAINED}`);
  const exported = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/models/${TRAINED}/export`),
  );
  await page.getByRole("button", { name: "Export ONNX" }).click();
  expect((await exported).postDataJSON()).toEqual({ format: "onnx", imgsz: 1280, half: false });
  await expect(page.getByTestId("model-detail").getByTestId(/^job-/)).toBeVisible();
  await expect(page.getByText(/1 active job/)).toBeVisible();

  const patched = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith(`/projects/${P}`));
  await page.getByRole("button", { name: "Use as pre-annotation model" }).click();
  expect((await patched).postDataJSON()).toEqual({ preannotation_model_id: TRAINED });

  await page.getByRole("button", { name: "Import weights from a file" }).click();
  await page.getByLabel("Model name").fill("yolo11m-coco");
  await page.getByLabel("Weights path").fill("E:\\Dev\\Yolo\\models\\yolo11m.pt");
  await expect(page.getByLabel("Class aliases")).toHaveValue("truck=dump_truck");
  const importRequest = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/models/import"),
  );
  await page.getByRole("button", { name: "Import weights", exact: true }).click();
  expect((await importRequest).postDataJSON()).toEqual({
    name: "yolo11m-coco",
    weights_path: "E:\\Dev\\Yolo\\models\\yolo11m.pt",
    class_aliases: { truck: "dump_truck" },
  });
  await expect(page).toHaveURL(new RegExp(`model=${MODEL}`));

  await page.getByRole("button", { name: "Delete model" }).click();
  const deleted = page.waitForRequest((r) => r.method() === "DELETE" && r.url().endsWith(`/models/${MODEL}`));
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await deleted;
  await expect(page.getByTestId("model-detail")).toHaveCount(0);
});

test("offers the bundled starter weights and imports one with a click", async ({ page }) => {
  await page.goto(`/p/${P}/models`);
  await expect(page.getByRole("heading", { name: "Starter models" })).toBeVisible();
  const imported = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/models/import-starter"),
  );
  await page.getByRole("button", { name: "Add YOLO11 nano" }).click();
  expect((await imported).postDataJSON()).toEqual({ key: "yolo11n" });
});

test("a 501 registry shows the note and keeps the screen usable", async ({ page }) => {
  await page.route(isModelsList, (route: Route) =>
    route.fulfill(
      json({ error: { code: "not_implemented", message: "models arrive with S3", details: {} } }, 501),
    ),
  );
  await page.goto(`/p/${P}/models`);
  await expect(page.getByRole("note")).toContainText("The model registry is not available yet");
  // Nothing to import into: the import disclosure is not offered at all.
  await expect(page.getByRole("button", { name: "Import weights from a file" })).toHaveCount(0);
});
