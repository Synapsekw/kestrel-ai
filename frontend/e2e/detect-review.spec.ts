import { test, expect } from "@playwright/test";
import { fromMock, jsonReply } from "./mock";
import { evidencePath } from "./evidence";
import { enableDiagnostics } from "./fixtures/mapWorkspace";

// The contract's examples: the map source "May survey" (the newest survey, so Review opens on it)
// is counted by map run `r…0001` on map `a…0001`.
const P = "7f1c2e3a-1111-4000-8000-000000000001";
const MAP = "a0000000-6666-4000-8000-000000000001";
const RUN = "r0000000-7777-4000-8000-000000000001";
const EXCAVATOR = "c1a2b3c4-0000-4000-8000-000000000001";

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

test("a map run is reviewed in the workspace from the keyboard (A accept, X reject, Tab next)", async ({
  page,
}) => {
  await enableDiagnostics(page);
  // R-T11: the run inspector offers review only for a finished run.
  const run = await fromMock(page, `/api/v1/projects/${P}/map-runs/${RUN}`);
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/map-runs/${RUN}`,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill(jsonReply({ ...run, id: RUN, map_id: MAP, state: "succeeded" }))
        : route.fallback(),
  );
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

  await page.goto(`/p/${P}/review?view=runs`);
  await expect(page.getByTestId("review-run")).toContainText("machinery-v3");
  await page.getByRole("button", { name: "Review on the map" }).click();

  // R-URL: the settled URL (the arrival's `map=` is stripped) and the run inspector it opened.
  await expect(page.getByTestId("map-workspace")).toBeVisible();
  const inspector = page.getByTestId("map-inspector");
  await expect(inspector).toHaveAttribute("data-sel", `run:${RUN}`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/maps\\?(.*&)?sel=run(:|%3A)${RUN}(&|$)`));
  await expect(page.getByTestId("run-inspector")).toBeVisible();

  // Tab starts the review at the first pending detection. Its shortcut is bound only once the run
  // has loaded as succeeded, which is when "Start review" is shown, so wait for that before pressing.
  await expect(page.getByRole("button", { name: /^Start review/ })).toBeEnabled();
  await page.keyboard.press("Tab");
  const current = page.getByTestId("review-current");
  await expect(current).toHaveAttribute("data-id", detection(1).id);
  await expect(page.getByTestId("tool-hint")).toContainText("A accept");
  await page.screenshot({ path: evidencePath("maps", "map-review.png"), fullPage: true });

  // A is bound once the project's types are in (see maps-review.spec.ts).
  await expect(
    page.getByTestId("map-inspector").getByRole("button", { name: "Accept", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("a");
  await expect(current).toHaveAttribute("data-id", detection(2).id);
  await page.keyboard.press("x");
  await expect(current).toHaveAttribute("data-id", detection(3).id);
  await page.keyboard.press("Tab");
  await expect(current).toHaveAttribute("data-id", detection(4).id);

  expect(decisions).toEqual([
    { detection_ids: [detection(1).id], action: "accept" },
    { detection_ids: [detection(2).id], action: "reject" },
  ]);
});
