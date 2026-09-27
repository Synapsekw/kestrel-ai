import { expect, test } from "@playwright/test";
import { CATALOGUE_PAGE, fulfilJson, P, RECENT_PROJECT, routeDatasets } from "./fixtures/appSections";

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

  const exported = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/datasets/d-lib-1/export"),
  );
  await page.getByRole("button", { name: "Build export" }).click();
  await exported;

  await page.getByRole("button", { name: "Delete dataset" }).click();
  const deleted = page.waitForRequest(
    (r) => r.method() === "DELETE" && r.url().endsWith("/datasets/d-lib-1"),
  );
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await deleted;
  await expect(page).toHaveURL(/\/models\/datasets$/);
});

test("the dataset builder counts a filter and creates the dataset as a job", async ({ page }) => {
  await routeDatasets(page);
  await page.route(
    (url) => url.pathname === "/api/v1/catalogue/types",
    (route) => fulfilJson(route, CATALOGUE_PAGE),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/projects",
    (route) =>
      route.request().method() === "GET"
        ? fulfilJson(route, { items: [RECENT_PROJECT], next_cursor: null })
        : route.fallback(),
  );
  await page.goto(`/models/datasets?project=${P}&types=t-1,t-2`);
  await expect(page.getByLabel("Ahmadia")).toBeChecked({ timeout: 15_000 });
  await expect(page.getByTestId("preview-images")).toHaveText("30");
  await page.getByLabel("Name", { exact: true }).fill("machines-v2");
  const created = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/library/datasets"));
  await page.getByRole("button", { name: "Create dataset" }).click();
  expect((await created).postDataJSON()).toMatchObject({
    name: "machines-v2",
    task: "detect",
    filter: { project_ids: [P], type_ids: ["t-1", "t-2"], reviewed_only: true },
  });
  await expect(page).toHaveURL(/\/models\/datasets\/d-lib-2$/);
});
