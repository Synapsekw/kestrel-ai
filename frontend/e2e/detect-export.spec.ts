import { test, expect } from "@playwright/test";
import { asDetectionProject } from "./kinds";
import { evidencePath } from "./evidence";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const MAP_SOURCE = "50000000-3333-4000-8000-000000000002";

test.beforeEach(({ page }) => asDetectionProject(page, P));

test("the counts export as a CSV of every source, or a PDF report of one", async ({ page }) => {
  await page.goto(`/p/${P}/export`);
  const counts = page.getByRole("region", { name: "Counts" });
  await expect(counts).toBeVisible();
  await expect(counts).toContainText("Photos count detections");
  await page.screenshot({ path: evidencePath("detection-workspace", "export.png"), fullPage: true });

  const exported = () =>
    page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/projects/${P}/detect-exports`));

  let posted = exported();
  await counts.getByRole("button", { name: "Export" }).click();
  expect((await posted).postDataJSON()).toEqual({ format: "csv" });

  await counts.getByRole("radio", { name: "Report (PDF)" }).click();
  await counts.getByLabel("Sources").selectOption(MAP_SOURCE);
  posted = exported();
  await counts.getByRole("button", { name: "Export" }).click();
  expect((await posted).postDataJSON()).toEqual({ format: "pdf", source_id: MAP_SOURCE });
});
