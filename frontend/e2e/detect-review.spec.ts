import { test, expect } from "@playwright/test";
import { asDetectionProject, jsonReply } from "./kinds";
import { evidencePath } from "./evidence";

// The contract's examples: the map source "May survey" (the newest survey, so Review opens on it)
// is counted by map run `r…0001` on map `a…0001`.
const P = "7f1c2e3a-1111-4000-8000-000000000001";
const MAP = "a0000000-6666-4000-8000-000000000001";
const RUN = "r0000000-7777-4000-8000-000000000001";
const EXCAVATOR = "c1a2b3c4-0000-4000-8000-000000000001";
const DUMP_TRUCK = "c1a2b3c4-0000-4000-8000-000000000004";

const detection = (n: number) => ({
  id: `d0000000-1111-4000-8000-00000000000${n}`,
  class_id: EXCAVATOR,
  confidence: 0.9 - n / 100,
  x: 3000 + n * 200,
  y: 2400,
  w: 170,
  h: 110,
  angle: null,
  review_state: "unreviewed",
  provenance_kind: "local_model",
});

test.beforeEach(({ page }) => asDetectionProject(page, P));

test("a map is reviewed one detection at a time from the keyboard", async ({ page }) => {
  // The mock always answers the same detection; this walk hands out the one after `after_id`.
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/map-runs/${RUN}/next-unreviewed`,
    (route) => {
      const after = new URL(route.request().url()).searchParams.get("after_id");
      const n = after ? Number(after.slice(-1)) + 1 : 1;
      return route.fulfill(jsonReply({ detection: detection(n), remaining: 120 - n }));
    },
  );
  const decisions: unknown[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith(`/map-runs/${RUN}/review`))
      decisions.push(r.postDataJSON());
  });

  await page.goto(`/p/${P}/review`);
  await expect(page.getByRole("heading", { name: "Review", exact: true })).toBeVisible();
  await expect(page.getByLabel("Source")).toHaveValue("50000000-3333-4000-8000-000000000002");
  await expect(page.getByTestId("review-run")).toContainText("machinery-v3");
  await page.getByRole("button", { name: "Review on the map" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/maps/${MAP}\\?mode=review&run=${RUN}$`));

  const current = page.getByTestId("review-current");
  await expect(current).toHaveAttribute("data-id", detection(1).id);
  await expect(current).toContainText("excavator");
  await page.screenshot({ path: evidencePath("detection-workspace", "map-review.png"), fullPage: true });

  // A accepts, R rejects, 4 makes it a dump truck (the class with hotkey 4), N skips.
  await page.keyboard.press("a");
  await expect(current).toHaveAttribute("data-id", detection(2).id);
  await page.keyboard.press("r");
  await expect(current).toHaveAttribute("data-id", detection(3).id);
  await page.keyboard.press("4");
  await expect(current).toHaveAttribute("data-id", detection(4).id);
  await page.keyboard.press("n");
  await expect(current).toHaveAttribute("data-id", detection(5).id);

  expect(decisions).toEqual([
    { detection_ids: [detection(1).id], action: "accept" },
    { detection_ids: [detection(2).id], action: "reject" },
    { detection_ids: [detection(3).id], action: "reclass", class_id: DUMP_TRUCK },
  ]);
});
