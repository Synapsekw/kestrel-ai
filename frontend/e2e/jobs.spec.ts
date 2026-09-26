import { expect, test } from "@playwright/test";
import { JOB, P, appJobsBody, fulfilJson } from "./fixtures/appSections";

test("the Jobs section lists project and library jobs, opens one with its log, and cancels it", async ({
  page,
}) => {
  await page.route(
    (url) => url.pathname === "/api/v1/jobs",
    (route) => fulfilJson(route, appJobsBody(route.request().url())),
  );
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible({ timeout: 15_000 });
  const row = page.getByRole("row", { name: /Import/ });
  await expect(row).toContainText("Ahmadia");
  await expect(page.getByRole("radio", { name: "Running · 1" })).toBeVisible();

  const log = page.waitForRequest((r) => r.url().includes(`/projects/${P}/jobs/${JOB}/log`));
  await row.click();
  await expect(page).toHaveURL(new RegExp(`job=${JOB}`));
  await log;

  const cancel = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/projects/${P}/jobs/${JOB}/cancel`),
  );
  await page.getByRole("button", { name: "Cancel job" }).click();
  await cancel;
});

test("the Failed segment shows the error, and the library filter reaches the request", async ({ page }) => {
  const requested: string[] = [];
  await page.route(
    (url) => url.pathname === "/api/v1/jobs",
    (route) => {
      requested.push(route.request().url());
      return fulfilJson(route, appJobsBody(route.request().url()));
    },
  );
  await page.goto("/jobs?state=failed&project=library");
  await expect(page.getByRole("row", { name: /Training: ahmadia-v1-n/ })).toContainText("CUDA out of memory");
  expect(requested.some((u) => u.includes("project_id=library"))).toBe(true);
  await page.getByRole("radio", { name: "Finished" }).click();
  await expect(page).toHaveURL(/state=finished/);
  await expect(page.getByRole("row", { name: /Dataset build: machines-v1/ })).toContainText("Model library");
});
