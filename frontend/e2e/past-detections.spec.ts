import { test, expect } from "@playwright/test";
import { evidencePath } from "./evidence";

// The contract's examples, which the Prism mock serves: a training project that has detection runs
// and a map from before training and detection were split.
const P = "7f1c2e3a-1111-4000-8000-000000000001";

test("a training project with old detection runs shows Past detections, read-only", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes(`/projects/${P}/`)) writes.push(`${r.method()} ${r.url()}`);
  });
  await page.goto(`/p/${P}`);
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  // A training project has no Detect step; its old runs live under Past detections instead.
  await expect(nav.getByRole("link", { name: /^Detect/ })).toHaveCount(0);
  await nav.getByRole("link", { name: "Past detections" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/past$`));
  await expect(page.getByRole("heading", { name: "Past detections" })).toBeVisible();
  await expect(page.getByText("New detections belong in a detection project.")).toBeVisible();
  await expect(page.getByTestId("run-history")).toBeVisible();
  for (const name of [/New detection/, /^Start/, /Estimate/, /Resume run/]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  }
  await page.screenshot({ path: evidencePath("model-library", "past-detections-runs.png"), fullPage: true });

  // The maps stay read-only too: no import, no new run, but a map can move to a detection project.
  await page.getByRole("radio", { name: /^Maps/ }).click();
  const maps = page.getByRole("list", { name: "Maps" });
  await expect(maps).toBeVisible();
  await expect(page.getByRole("button", { name: "Import map" })).toHaveCount(0);
  await maps.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/past/maps/`));
  await expect(page.getByTestId("map-view")).toBeVisible();
  await expect(page.getByRole("button", { name: "New run" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Move to a detection project" })).toBeVisible();
  await page.screenshot({ path: evidencePath("model-library", "past-detections-map.png"), fullPage: true });
  expect(writes).toEqual([]);
});
