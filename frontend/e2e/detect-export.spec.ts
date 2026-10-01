import { test, expect } from "@playwright/test";
import { evidencePath } from "./evidence";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const MAP_SOURCE = "50000000-3333-4000-8000-000000000002";

test("the counts export as a CSV of every source or of one; the PDF is a Survey count report", async ({
  page,
}) => {
  await page.goto(`/p/${P}/reports/exports`);
  const counts = page.getByRole("region", { name: "Counts" });
  await expect(counts).toBeVisible();
  await expect(counts).toContainText("Photos count detections");
  await expect(counts.getByRole("radio", { name: /PDF/ })).toHaveCount(0);
  await expect(counts.getByRole("link", { name: "Create a Survey count report" })).toHaveAttribute(
    "href",
    `/p/${P}/reports?new=builtin-survey-counts`,
  );
  await page.screenshot({ path: evidencePath("detection-workspace", "export.png"), fullPage: true });

  const exported = () =>
    page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/projects/${P}/detect-exports`));

  let posted = exported();
  await counts.getByRole("button", { name: "Export" }).click();
  expect((await posted).postDataJSON()).toEqual({ format: "csv" });

  await counts.getByLabel("Sources").selectOption(MAP_SOURCE);
  posted = exported();
  await counts.getByRole("button", { name: "Export" }).click();
  expect((await posted).postDataJSON()).toEqual({ format: "csv", source_id: MAP_SOURCE });

  // Prism's template example is a single template; answer with the built-in the link names.
  await page.route(
    (u) => u.pathname === "/api/v1/report-templates",
    async (route) => {
      const res = await route.fetch();
      const page0 = await res.json();
      const base = page0.items[0];
      const items = [
        { ...base, id: "builtin-full", name: "Full inspection report", builtin: true },
        { ...base, id: "builtin-survey-counts", name: "Survey count report", builtin: true },
      ];
      await route.fulfill({ response: res, json: { ...page0, items, next_cursor: null } });
    },
  );
  await counts.getByRole("link", { name: "Create a Survey count report" }).click();
  // R7's report list opens New report from `?new=` and then drops it from the address (replace),
  // so a reload does not reopen the dialog.
  const dialog = page.getByRole("dialog", { name: "New report" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /Survey count/ })).toBeChecked();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/reports$`));
});
