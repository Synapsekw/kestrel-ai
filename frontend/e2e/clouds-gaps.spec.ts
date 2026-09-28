import { expect, test, type Page } from "@playwright/test";
import { CLOUD } from "./fixtures/clouds";
import { cloudFinding, gridPins, serveCloudWorld } from "./fixtures/cloudWorld";
import { API, P, SWIFTSHADER, diagnosticsOn, pinStates, viewerSettled, ws } from "./fixtures/cloudWorkspace";
import { jsonReply } from "./mock";

// C-G Task 6: the one §15 item no unit spec covered (docs/evidence/clouds/README.md, coverage) — the
// `?finding=` cloud arrival. `?from_image=&px=` (posed and position-only) is already e2e-tested in
// clouds-cameras.spec.ts; items 1-9, 11, 12c-d are present in their owners' specs, and 12a/12b/13 are
// covered by clouds-journey.spec.ts / clouds-frame-time.spec.ts — nothing else belongs in this file.
test.use(SWIFTSHADER);
test.beforeEach(async ({ page }) => diagnosticsOn(page));

async function open(page: Page, search = "") {
  await page.goto(`/p/${P}/clouds/${CLOUD}${search}`);
  await viewerSettled(page);
}

test("item 10: ?finding= selects the finding and frames its pin", async ({ page }) => {
  const f = cloudFinding(0, [243520, 3178030, 0.4]);
  await serveCloudWorld(page, { findings: [f] });
  await open(page, `?finding=${f.id as string}`);
  await expect(ws(page).callout).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => {
      const p = await page.evaluate(() => window.__kestrelCloudViewer!.pickCenter());
      return p ? Math.hypot(p.x - 243520, p.y - 3178030) : Infinity;
    })
    .toBeLessThan(3);
});

/**
 * C-P1's flagged concern (Task 1 report): `useFindingArrival` reads the finding directly
 * (`fetchFinding`, one document), not from the capped pins list, so it always selects a finding that
 * exists, even one the 500-pin cap (`PIN_CAP`, `frontend/src/api/cloudFindings.ts`) left off the
 * loaded page. `flyToPin` also flies to the finding's own anchor coordinates, not to anything read
 * from the pins array, so the camera still moves there. The callout and the pin glyph come from the
 * pins `usePinsFeature` holds; since C-G Task 14 the arrived finding is added to them when the capped
 * list lacks it (`frontend/src/clouds/workspace/features/pins.tsx`), so the pin is drawn and its
 * callout shows.
 */
test("item 10: ?finding= for a finding outside the loaded 500 pins shows its pin and callout", async ({
  page,
}) => {
  const overflow = cloudFinding(500, [243521, 3178031, 0.4]); // the 501st: past PIN_CAP
  const world = await serveCloudWorld(page, { findings: [...gridPins(500), overflow] });
  // serveCloudWorld's fake findings-list route answers every finding it was given, ignoring
  // `limit`/`sort` — replace it (for the list endpoint only) with one that reproduces the real API's
  // 500-pin cap; the single-finding route it falls back to (unaffected by this override) still
  // answers the overflow finding's own GET, exactly as the real API would for a finding that exists
  // but did not make the cloud's first page of findings.
  await page.route(
    (u) => u.pathname === `${API}/findings`,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill(jsonReply({ items: world.findings.slice(0, 500), next_cursor: null }))
        : route.fallback(),
  );
  await open(page, `?finding=${overflow.id as string}`);
  // The camera still moves to the finding's own anchor (flyToPin reads the finding, not the pins list).
  await expect
    .poll(
      async () => {
        const p = await page.evaluate(() => window.__kestrelCloudViewer!.pickCenter());
        return p ? Math.hypot(p.x - 243521, p.y - 3178031) : Infinity;
      },
      { timeout: 20_000 },
    )
    .toBeLessThan(3);
  // The arrived finding joins the pins: its callout shows and its pin is drawn.
  await expect(ws(page).callout).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => (await pinStates(page)).find((p) => p.id === overflow.id)?.state ?? "absent")
    .toBe("visible");
});
