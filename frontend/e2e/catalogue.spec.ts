import { expect, test } from "@playwright/test";
import { BACKFILL_JOB, CATALOGUE_PAGE, SEVERITY, fulfilJson } from "./fixtures/appSections";

test("the Catalogue classifies a migrated type, offers the backfill and edits the severity scale", async ({
  page,
}) => {
  await page.route(
    (url) => url.pathname === "/api/v1/catalogue/types",
    (route) => fulfilJson(route, CATALOGUE_PAGE),
  );
  await page.route(
    (url) => /^\/api\/v1\/catalogue\/types\/[^/]+$/.test(url.pathname),
    (route) => fulfilJson(route, { ...CATALOGUE_PAGE.items[0], kind: "defect", backfill_candidates: true }),
  );
  await page.route(
    (url) => url.pathname.endsWith("/backfill"),
    (route) => fulfilJson(route, { job: BACKFILL_JOB }, 202),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/catalogue/severity",
    (route) =>
      fulfilJson(route, {
        levels:
          route.request().method() === "PUT"
            ? (route.request().postDataJSON() as { levels: unknown }).levels
            : SEVERITY,
      }),
  );

  await page.goto("/catalogue");
  await expect(page.getByRole("heading", { name: "Catalogue", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByText("2 types came from your existing projects. Mark which are defects."),
  ).toBeVisible();

  await page.getByRole("row", { name: /Excavator/ }).click();
  await page.getByRole("radio", { name: "Defect", exact: true }).click();
  const patch = page.waitForRequest((r) => r.method() === "PATCH");
  await page.getByRole("button", { name: "Save type" }).click();
  expect((await patch).postDataJSON()).toEqual({ kind: "defect" });

  const backfill = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/backfill"));
  await page.getByRole("button", { name: "Create findings from accepted annotations of this type" }).click();
  await backfill;
  await expect(page.getByRole("link", { name: "Follow in Jobs" })).toHaveAttribute(
    "href",
    "/jobs?project=library&job=j-backfill",
  );

  await page.goto("/catalogue/severity");
  await page.getByRole("button", { name: "Add level" }).click();
  await page.getByLabel("Name of level 5").fill("Emergency");
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/catalogue/severity"));
  await page.getByRole("button", { name: "Save scale" }).click();
  expect(((await put).postDataJSON() as { levels: unknown[] }).levels).toHaveLength(5);
  await expect(page.getByText("Severity scale saved")).toBeVisible();
});
