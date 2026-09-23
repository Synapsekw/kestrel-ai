import { test, expect, type Route } from "@playwright/test";
import { evidencePath } from "./evidence";
import { fromMock } from "./kinds";

// Ids from the contract's LibraryModelPage example, which the Prism mock serves.
const TRAINED = "m0000000-2222-4000-8000-000000000001";
const STARTER = "m0000000-2222-4000-8000-000000000002";

const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  headers: { "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(body),
});

const CSV = [
  "epoch,time,metrics/precision(B),metrics/recall(B),metrics/mAP50(B),metrics/mAP50-95(B)",
  "1,12.3,0.31,0.22,0.18,0.09",
  "2,24.1,0.52,0.41,0.45,0.24",
  "3,36.0,0.78,0.66,0.71,0.44",
].join("\n");

const isJobsList = (url: URL) => url.pathname === "/api/v1/library/jobs";

test.beforeEach(async ({ page }) => {
  // No library job is running: the mock's example job would otherwise show as an import in progress.
  await page.route(isJobsList, (route: Route) => route.fulfill(json({ items: [], next_cursor: null })));
});

test("/library lists the mock's models and opening one shows where it came from", async ({ page }) => {
  await page.route(
    (url) => url.pathname.endsWith(`/library/models/${TRAINED}/artifacts/results_csv`),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/csv",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: CSV,
      }),
  );
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  const table = page.getByTestId("model-table");
  await expect(table).toContainText("ahmadia-v1-n");
  await expect(table).toContainText("yolo11n-coco");
  await page.getByRole("button", { name: "Select model ahmadia-v1-n" }).click();
  await expect(page).toHaveURL(new RegExp(`model=${TRAINED}`));
  const detail = page.getByTestId("model-detail");
  await expect(detail.getByTestId("provenance")).toContainText("Trained in Ahmadia on v1");
  await expect(page.getByTestId("class-metrics")).toContainText("excavator");
  await expect(page.getByTestId("training-curve")).toHaveAttribute("data-points", "3");
  await page.screenshot({ path: evidencePath("model-library", "library-detail.png"), fullPage: true });

  await page.getByRole("radio", { name: "Starter" }).click();
  await expect(table).not.toContainText("ahmadia-v1-n");
  await page.getByRole("button", { name: "Select model yolo11n-coco" }).click();
  await expect(page).toHaveURL(new RegExp(`model=${STARTER}`));
  await expect(page.getByTestId("provenance")).toContainText("general-purpose starter model");
});

test("import, export and delete send the library requests", async ({ page }) => {
  await page.goto(`/library?model=${TRAINED}`);
  const exported = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/library/models/${TRAINED}/export`),
  );
  await page.getByRole("button", { name: "Export ONNX" }).click();
  expect((await exported).postDataJSON()).toMatchObject({ format: "onnx" });

  await page.getByRole("button", { name: "Import a model file" }).click();
  const form = page.getByRole("form", { name: "Import a model file" });
  await form.getByLabel("Model name").fill("client-x-machinery");
  await form.getByLabel("Model file").fill("E:\\Models\\client-x\\best.pt");
  await form.getByLabel("Supplier").fill("Client X");
  const imported = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/library/models/import"),
  );
  await form.getByRole("button", { name: "Add to library" }).click();
  expect((await imported).postDataJSON()).toMatchObject({
    name: "client-x-machinery",
    weights_path: "E:\\Models\\client-x\\best.pt",
    supplier: "Client X",
  });

  await page.getByRole("button", { name: "Delete model" }).click();
  // The mock's usage example names one project, so a warning comes before the delete.
  await expect(page.getByTestId("delete-usage")).toContainText("Ahmadia");
  const deleted = page.waitForRequest(
    (r) => r.method() === "DELETE" && r.url().endsWith(`/library/models/${TRAINED}`),
  );
  await page.getByRole("button", { name: "Delete anyway" }).click();
  await deleted;
});

test("an unopened library blocks the screen with the reason and the folder", async ({ page }) => {
  await page.route(
    (url) => url.pathname === "/api/v1/library/status",
    (route) =>
      route.fulfill(
        json({
          available: false,
          root: "C:\\Users\\operator\\AppData\\Roaming\\kestrel-ai\\library",
          error: "library.db is not a database",
        }),
      ),
  );
  await page.goto("/library");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("The model library could not be opened");
  await expect(alert).toContainText("library.db is not a database");
  await expect(page.getByTestId("model-table")).toHaveCount(0);
});

test("an import runs as a job with progress, and the new model is selected when it finishes", async ({
  page,
}) => {
  const IMPORTED = "m0000000-2222-4000-8000-0000000000aa";
  const job = {
    id: "j0000000-4444-4000-8000-0000000000aa",
    project_id: "library",
    type: "library_import",
    state: "running",
    progress: 0.5,
    message: "Checking the model file",
    log_path: "runs/j0000000-4444-4000-8000-0000000000aa/job.log",
    params: { name: "client-x-machinery" },
    result: null,
    error: null,
    created_at: "2026-09-23T10:00:00Z",
    started_at: "2026-09-23T10:00:01Z",
    finished_at: null,
  };
  // The import is running until the operator has seen its progress; then it succeeds.
  let finished = false;
  const current = () =>
    finished
      ? {
          ...job,
          state: "succeeded",
          progress: 1,
          result: { model_id: IMPORTED },
          finished_at: "2026-09-23T10:00:05Z",
        }
      : job;
  await page.route(
    (url) => url.pathname === "/api/v1/library/models/import",
    (route) => route.fulfill(json({ job }, 202)),
  );
  await page.route(isJobsList, (route) => route.fulfill(json({ items: [current()], next_cursor: null })));
  await page.route(
    (url) => url.pathname === `/api/v1/library/jobs/${job.id}`,
    (route) => route.fulfill(json(current())),
  );
  // Once the import succeeded, the library lists the new model as well as the mock's two.
  const listed = await fromMock<{ items: Record<string, unknown>[]; next_cursor: null }>(
    page,
    "/api/v1/library/models",
  );
  const imported = {
    ...listed.items[0],
    id: IMPORTED,
    name: "client-x-machinery",
    origin: "imported",
    supplier: "Client X",
    notes: "",
    metrics: null,
    artifacts: {},
    exports: {},
    provenance: { source_file: "E:\\Models\\client-x\\best.pt" },
    sha256: "1".repeat(64),
    created_at: "2026-09-23T10:00:05Z",
  };
  await page.route(
    (url) => url.pathname === "/api/v1/library/models",
    (route) => route.fulfill(json(finished ? { ...listed, items: [imported, ...listed.items] } : listed)),
  );

  await page.goto("/library");
  await expect(page.getByTestId("model-table")).toContainText("ahmadia-v1-n");
  await page.getByRole("button", { name: "Import a model file" }).click();
  const form = page.getByRole("form", { name: "Import a model file" });
  await form.getByLabel("Model name").fill("client-x-machinery");
  await form.getByLabel("Model file").fill("E:\\Models\\client-x\\best.pt");
  await form.getByLabel("Supplier").fill("Client X");
  await form.getByRole("button", { name: "Add to library" }).click();

  const bar = page.getByRole("progressbar", { name: /Model import: client-x-machinery/ });
  await expect(bar).toBeVisible();
  await page.screenshot({
    path: evidencePath("model-library", "library-import-running.png"),
    fullPage: true,
  });
  finished = true;

  await expect(page).toHaveURL(new RegExp(`model=${IMPORTED}`), { timeout: 10_000 });
  await expect(
    page.getByTestId("model-detail").getByRole("heading", { name: "client-x-machinery" }),
  ).toBeVisible();
  await expect(bar).toHaveCount(0);
  await page.screenshot({
    path: evidencePath("model-library", "library-import-selected.png"),
    fullPage: true,
  });
});
