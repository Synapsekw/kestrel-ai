import { test, expect } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const JOB = "j0000000-4444-4000-8000-000000000001";

test("opens the jobs panel from the top bar, shows progress and log, cancels and closes", async ({
  page,
}) => {
  await page.goto(`/p/${P}/data`);
  // First page of a run: a cold dev server can need more than the default 5 s (as in boot.spec).
  await expect(page.getByRole("heading", { name: "Data Manager" })).toBeVisible({ timeout: 15_000 });
  const listed = page.waitForRequest(
    (r) => r.method() === "GET" && r.url().includes(`/projects/${P}/jobs?limit=100`),
  );
  await page.getByRole("button", { name: /active jobs?$/ }).click();
  await listed;
  const panel = page.getByRole("dialog", { name: "Jobs" });
  await expect(panel).toBeVisible();
  const card = panel.getByTestId(`job-${JOB}`);
  await expect(card).toContainText("Import");
  await expect(card.getByTestId("jobcard-state")).toHaveText("Running");
  await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  await expect(card).toContainText("1386 / 3299 images");
  await expect(page.getByRole("button", { name: "1 active job" })).toBeVisible();

  const log = page.waitForRequest((r) => r.url().includes(`/jobs/${JOB}/log?tail=200`));
  await card.getByRole("button", { name: "Show log" }).click();
  await log;
  await expect(card.getByTestId("jobcard-log")).toContainText("50 / 3299 images");

  const cancel = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/jobs/${JOB}/cancel`),
  );
  await card.getByRole("button", { name: "Cancel job" }).click();
  await cancel;

  await page.getByRole("button", { name: "Close jobs" }).click();
  await expect(panel).toHaveCount(0);
});

test("a failed job shows its error and no cancel button", async ({ page }) => {
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${P}/jobs`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          items: [
            {
              id: "j-failed",
              project_id: P,
              type: "train",
              state: "failed",
              progress: 0.3,
              message: "epoch 15/50 mAP50 0.410",
              log_path: "runs/j-failed/job.log",
              params: { name: "ahmadia-v1-n" },
              result: null,
              error: "CUDA out of memory",
              created_at: "2026-09-17T10:05:00Z",
              started_at: "2026-09-17T10:05:01Z",
              finished_at: "2026-09-17T10:35:01Z",
            },
          ],
          next_cursor: null,
        }),
      }),
  );
  await page.goto(`/p/${P}/data`);
  await page.getByRole("button", { name: /active jobs?$/ }).click();
  const card = page.getByRole("dialog", { name: "Jobs" }).getByTestId("job-j-failed");
  await expect(card).toContainText("Training: ahmadia-v1-n");
  await expect(card.getByTestId("jobcard-state")).toHaveText("Failed");
  await expect(card.getByRole("alert")).toHaveText("CUDA out of memory");
  await expect(card).toContainText("30 min 00 s");
  await expect(card.getByRole("button", { name: "Cancel job" })).toHaveCount(0);
});
