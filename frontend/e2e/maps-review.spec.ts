import { test, expect } from "@playwright/test";
import { evidencePath } from "./evidence";
import {
  MAP_SEP,
  P,
  RUN,
  SITE,
  clickSite,
  enableDiagnostics,
  serveMapWorkspace,
} from "./fixtures/mapWorkspace";

// Spec M §15 flow 5 and §9.3: selecting a pending defect detection and pressing A accepts it; the
// server makes it a finding in the same transaction (the fake then sends `findings.changed {ids}`);
// the pin appears and F's inspector opens on it.

test.beforeEach(async ({ page }) => {
  await enableDiagnostics(page);
});

test("flow 5: a pending defect detection, A, then a finding pin and F's inspector", async ({ page }) => {
  const world = await serveMapWorkspace(page);
  await page.goto(`/p/${P}/maps?map=${MAP_SEP}&sel=run:${RUN}`);
  await expect(page.getByTestId("map-workspace")).toBeVisible();
  // R-T11: a `sel=run:` arrival opens the run inspector first.
  await expect(page.getByTestId("map-inspector")).toHaveAttribute("data-sel", `run:${RUN}`);

  await clickSite(page, SITE.cE, SITE.cN); // inside the detection's corners
  const current = page.getByTestId("review-current");
  await expect(current).toHaveAttribute("data-id", String(world.detections[0].id));
  await expect(page.getByTestId("tool-hint")).toContainText("A accept");

  const findingReads = () =>
    world.calls.filter((c) => c.method === "GET" && c.path.startsWith("/map-workspace/findings")).length;
  const readsBefore = findingReads();
  await page.keyboard.press("a");
  await expect
    .poll(
      () => world.calls.find((c) => c.method === "POST" && /\/map-runs\/[^/]+\/review$/.test(c.path))?.body,
    )
    .toEqual({ detection_ids: [world.detections[0].id], action: "accept" });
  const inspector = page.getByTestId("map-inspector");
  await expect(inspector).toHaveAttribute("data-sel", `finding:${world.findings[0]?.id}`);
  await expect(inspector).toContainText("F-0042");
  // The pin: the Findings layer re-reads its pins after `findings.changed`, and gets the new one.
  await expect.poll(findingReads).toBeGreaterThan(readsBefore);
  await page.screenshot({ path: evidencePath("maps", "flow5-finding.png") });
});
