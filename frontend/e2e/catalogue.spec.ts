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

test("the type editor saves a definition and ordered severity rules", async ({ page }) => {
  // After migration 0003 every type carries both fields; Crack starts with neither filled.
  const crack = { ...CATALOGUE_PAGE.items[2], definition: null, severity_rules: [] };
  await page.route(
    (url) => url.pathname === "/api/v1/catalogue/types",
    (route) => fulfilJson(route, { items: [crack], next_cursor: null, needs_classification: false }),
  );
  await page.route(
    (url) => /^\/api\/v1\/catalogue\/types\/[^/]+$/.test(url.pathname),
    (route) =>
      fulfilJson(route, {
        ...crack,
        ...(route.request().postDataJSON() as object),
        backfill_candidates: false,
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/catalogue/severity",
    (route) => fulfilJson(route, { levels: SEVERITY }),
  );

  await page.goto("/catalogue");
  await page.getByRole("row", { name: /Crack/ }).click({ timeout: 15_000 });
  await page.getByLabel("Definition", { exact: true }).fill("A linear fracture in concrete.");

  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByLabel("Rule 1 condition", { exact: true }).fill("Hairline, under 0.3 mm");
  await page.getByLabel("Rule 1 severity", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByLabel("Rule 2 condition", { exact: true }).fill("Wider than 5 mm");
  await page.getByLabel("Rule 2 severity", { exact: true }).selectOption("4");

  // Alt+Down on a native select must move the rule, not open its dropdown, and focus stays put.
  await page.getByLabel("Rule 1 severity", { exact: true }).focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.getByLabel("Rule 2 condition", { exact: true })).toHaveValue("Hairline, under 0.3 mm");
  await expect(page.getByLabel("Rule 2 severity", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Rule 2 severity", { exact: true })).toHaveValue("1");
  await expect(page.getByRole("status").filter({ hasText: "Rule moved to position 2 of 2" })).toBeAttached();
  // ...and back again, so the order below is the one the save asserts.
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.getByLabel("Rule 1 severity", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Rule 1 condition", { exact: true })).toHaveValue("Hairline, under 0.3 mm");

  await page.getByLabel("Rule 2 condition", { exact: true }).press("Alt+ArrowUp");
  await expect(page.getByLabel("Rule 1 condition", { exact: true })).toHaveValue("Wider than 5 mm");
  await expect(page.getByLabel("Rule 1 condition", { exact: true })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Rule moved to position 1 of 2" })).toBeAttached();

  const patch = page.waitForRequest((r) => r.method() === "PATCH");
  await page.getByRole("button", { name: "Save type" }).click();
  expect((await patch).postDataJSON()).toEqual({
    definition: "A linear fracture in concrete.",
    severity_rules: [
      { when: "Wider than 5 mm", severity: 4 },
      { when: "Hairline, under 0.3 mm", severity: 1 },
    ],
  });
});
