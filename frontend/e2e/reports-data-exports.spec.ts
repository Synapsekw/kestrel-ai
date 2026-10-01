import { test, expect } from "@playwright/test";
import { evidencePath } from "./evidence";
import { ui } from "./fixtures/reportsUi";

// Spec 2026-09-26-reports §17 flow 4 in the gate suite (plan 2026-09-30-reports-r10, ruling R10-2):
// the counts CSV needs a detection run, which only the Prism example project has. The real backend
// proves the results export in reports-real-backend.spec.ts. detect-export.spec.ts covers the counts
// form itself; this is the flow-4 statement end to end: the old address redirects, the counts CSV
// still posts, there is no PDF option, and the link opens New report on the Survey count template.
const P = "7f1c2e3a-1111-4000-8000-000000000001";

test("Data exports: /export redirects, the counts CSV still posts, and the PDF became a report link", async ({
  page,
}) => {
  await page.goto(`/p/${P}/export`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/reports/exports$`));
  await expect(page.getByRole("radio", { name: "Data exports" })).toBeChecked();
  const counts = ui.counts(page);
  await expect(counts).toContainText("Photos count detections"); // the mock's sources have loaded

  const posted = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/projects/${P}/detect-exports`),
  );
  await counts.getByRole("button", { name: "Export" }).click();
  expect((await posted).postDataJSON()).toEqual({ format: "csv" });
  await expect(counts.getByRole("radio", { name: "Report (PDF)" })).toHaveCount(0);
  await page.screenshot({ path: evidencePath("reports", "data-exports.png"), fullPage: true });

  // Prism's template example is a single template; answer with the built-in the link names.
  await page.route(
    (u) => u.pathname === "/api/v1/report-templates",
    async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      const base = body.items[0];
      const items = [
        { ...base, id: "builtin-full", name: "Full inspection report", builtin: true },
        { ...base, id: "builtin-survey-counts", name: "Survey count report", builtin: true },
      ];
      await route.fulfill({ response: res, json: { ...body, items, next_cursor: null } });
    },
  );
  await ui.surveyCountLink(page).click();
  // R7's list opens New report from `?new=builtin-survey-counts`, then drops `new` from the address.
  await expect(ui.newDialog(page)).toBeVisible();
  await expect(ui.templateRadio(page, "Survey count report")).toBeChecked();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/reports$`));
  // A template refetch can still be in this route's `route.fetch()` when the test ends; without this
  // the late error is reported against the next test in the worker.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
