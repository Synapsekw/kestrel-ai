import { test, expect } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const MODEL = "m0000000-2222-4000-8000-000000000001";
const IMG = "10000000-5555-4000-8000-000000000001";
const IMG2 = "10000000-5555-4000-8000-000000000002";
const RUN = "q0000000-8888-4000-8000-000000000001";
const JOB = "j0000000-4444-4000-8000-000000000001";

/**
 * The mock's run points at job `…0003`, but `GET /jobs/{id}` always answers with job `…0001`, so the
 * tracked job would never resolve. This route hands the run the job id the mock actually serves.
 */
const runWithMockJob = {
  id: RUN,
  kind: "cloud_provider",
  model_id: null,
  provider: "anthropic",
  model_name: "claude-opus-5",
  query: "dump trucks",
  image_ids: [IMG, IMG2],
  tiling: { enabled: true, tile_size: 1280, overlap: 0.2, nms_iou: 0.5 },
  conf: 0.25,
  job_id: JOB,
  box_count: 7,
  promoted_at: null,
  created_at: "2026-09-17T13:00:00Z",
};

test("estimates and starts a cloud query, then reviews results, promotes and lists the run", async ({
  page,
}) => {
  // The card re-polls the run while its job is active, so the route has to remember the promotion.
  let promotedAt: string | null = null;
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${P}/query-runs/${RUN}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ...runWithMockJob, promoted_at: promotedAt }),
      }),
  );
  const unlabeled = page.waitForRequest(
    (r) => r.url().includes(`/projects/${P}/images?`) && r.url().includes("labeled=false"),
  );
  await page.goto(`/p/${P}/query`);
  await unlabeled;
  await expect(page.getByRole("heading", { name: "Query" })).toBeVisible();
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue(MODEL);
  await expect(page.getByTestId("image-count")).toHaveText("2 images selected");
  const grouped = page.waitForRequest((r) => r.url().includes("group_key=0031"));
  await page.getByLabel("Images", { exact: true }).selectOption("group");
  // The project's flights come from the stats: a list, not a key to type.
  await page.getByLabel("Group key").selectOption("0031");
  await grouped;

  await page.getByLabel("Cloud provider").check();
  // A cloud run costs money: it cannot start before its estimate was shown.
  await expect(page.getByRole("button", { name: "Start" })).toBeDisabled();
  await expect(page.getByLabel("Provider", { exact: true })).toHaveValue("anthropic");
  // Playwright's toBeDisabled does not treat <option disabled> as disabled; check the DOM property.
  await expect(page.getByRole("option", { name: /OpenAI/ })).toHaveJSProperty("disabled", true);
  await page.getByLabel("Query", { exact: true }).fill("dump trucks");
  await page.getByLabel("Confidence", { exact: true }).fill("0.3");

  const expected = {
    kind: "cloud_provider",
    provider: "anthropic",
    query: "dump trucks",
    image_ids: [IMG, IMG2],
    tiling: { enabled: true, tile_size: 1280, overlap: 0.2, nms_iou: 0.5 },
    conf: 0.3,
  };
  const estimated = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/query-runs/estimate"),
  );
  await page.getByRole("button", { name: "Estimate" }).click();
  expect((await estimated).postDataJSON()).toEqual(expected);
  await expect(page.getByTestId("estimate")).toContainText("40 requests");
  await expect(page.getByTestId("estimate")).toContainText("$0.80");

  const created = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/projects/${P}/query-runs`),
  );
  await page.getByRole("button", { name: "Start" }).click();
  expect((await created).postDataJSON()).toEqual(expected);
  await expect(page).toHaveURL(new RegExp(`run=${RUN}`));
  const card = page.getByTestId("run-card");
  await expect(card).toContainText('Anthropic: "dump trucks"');
  await expect(card.getByTestId("box-count")).toHaveText("7 boxes written so far");
  await expect(card.getByTestId(`job-${JOB}`)).toBeVisible();
  await expect(page.getByText(/1 active job/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Review results" })).toHaveAttribute(
    "href",
    `/p/${P}/review?ids=${IMG},${IMG2}`,
  );

  const promoted = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/query-runs/${RUN}/promote`),
  );
  await page.getByLabel("Minimum confidence").fill("0.6");
  await page.getByRole("button", { name: "Accept as labels…" }).click();
  // The first request only counts; the operator confirms the number before anything is accepted.
  expect((await promoted).postDataJSON()).toEqual({ min_confidence: 0.6, dry_run: true });
  await expect(page.getByTestId("promote-confirm")).toContainText("6 unreviewed boxes at or above 0.6");
  const confirmed = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/query-runs/${RUN}/promote`),
  );
  await page.getByRole("button", { name: "Accept 6 boxes" }).click();
  expect((await confirmed).postDataJSON()).toEqual({ min_confidence: 0.6, dry_run: false });
  promotedAt = "2026-09-17T13:30:00Z";
  await expect(page.getByRole("status").filter({ hasText: "6 boxes accepted" })).toBeVisible();
  await expect(card.getByText("Accepted as labels")).toBeVisible();
  await expect(page.getByTestId("run-history")).toContainText("dump trucks");

  const narrowed = page.waitForRequest(
    (r) => r.url().includes(`/projects/${P}/images?`) && r.url().includes(`ids=${IMG}`),
  );
  await page.getByRole("link", { name: "Review results" }).click();
  await narrowed;
  await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
  await expect(page.getByTestId("run-filter")).toContainText("of the 2 images of this detection run");
  await expect(page.getByRole("link", { name: "Show the whole queue" })).toHaveAttribute(
    "href",
    `/p/${P}/review`,
  );
});

test("a local-model run over the first N images; a 501 estimate shows the note", async ({ page }) => {
  await page.goto(`/p/${P}/query`);
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue(MODEL);
  const firstN = page.waitForRequest(
    (r) => r.url().includes(`/projects/${P}/images?`) && r.url().includes("limit=2"),
  );
  await page.getByLabel("Images", { exact: true }).selectOption("first_n");
  await page.getByLabel("Number of images").fill("2");
  await firstN;
  await page.getByLabel("Tiling").uncheck();
  const estimated = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/query-runs/estimate"),
  );
  await page.getByRole("button", { name: "Estimate" }).click();
  expect((await estimated).postDataJSON()).toEqual({
    kind: "local_model",
    model_id: MODEL,
    image_ids: [IMG, IMG2],
    tiling: { enabled: false, tile_size: 1280, overlap: 0.2, nms_iou: 0.5 },
    conf: 0.25,
  });
  await expect(page.getByTestId("estimate")).toBeVisible();

  await page.route(
    (url) => url.pathname.endsWith("/query-runs/estimate"),
    (route) =>
      route.fulfill({
        status: 501,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: { code: "not_implemented", message: "query runs arrive with S4", details: {} },
        }),
      }),
  );
  await page.getByLabel("Confidence", { exact: true }).fill("0.4");
  await expect(page.getByTestId("estimate")).toHaveCount(0);
  await page.getByRole("button", { name: "Estimate" }).click();
  await expect(page.getByRole("note")).toContainText("Query runs are not available yet");
  await expect(page.getByRole("heading", { name: "Query" })).toBeVisible();
});

test("an interrupted run offers Resume, which re-submits the run's job", async ({ page }) => {
  const failedJob = {
    id: JOB,
    project_id: P,
    type: "infer",
    state: "failed",
    progress: 0.4,
    message: "12 / 50 images, 37 boxes",
    log_path: `runs/${JOB}/job.log`,
    params: {},
    result: null,
    error: "provider timed out",
    created_at: "2026-09-17T13:00:00Z",
    started_at: "2026-09-17T13:00:01Z",
    finished_at: "2026-09-17T13:04:00Z",
  };
  const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body),
  });
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${P}/query-runs/${RUN}`,
    (route) => route.fulfill(json(runWithMockJob)),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${P}/jobs/${JOB}`,
    (route) => route.fulfill(json(failedJob)),
  );

  await page.goto(`/p/${P}/query?run=${RUN}`);
  const card = page.getByTestId("run-card");
  await expect(card.getByTestId("jobcard-state")).toHaveText("Failed");
  await expect(card.getByRole("alert")).toHaveText("provider timed out");
  const resumed = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/query-runs/${RUN}/resume`),
  );
  await card.getByRole("button", { name: "Resume run" }).click();
  expect((await resumed).postDataJSON()).toBeNull();
  await expect(page.getByRole("status").filter({ hasText: "Resumed (job" })).toBeVisible();
});
