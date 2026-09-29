import { writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { P, serveImages, syntheticFrames } from "./images/world";
import { ws } from "./images/ui";
import { evidencePath } from "./evidence";

// Spec §17 flow 7, §15 bounded reads, §18 item 8; rulings E5, E6, E7.
const N = 20_000;
// The 500 ms index budget is machine speed (78 ms on the dev machine, 785 ms once on the 4-vCPU CI
// runner, run 36458637333), so like the suite's other budgets it holds only in the perf config
// (metadata.frameBudget, `pnpm -C frontend e2e:perf`); the normal suite keeps a stall guard.
const INDEX_BUDGET_MS = 500;
const INDEX_STALL_MS = 5_000;
const TOTAL = /of\s*20[,.\s\u202f]?000/;

test("20,000 images: the index renders in 500 ms, the grid keeps at most 60 thumbs, #15,000 opens", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const frames = syntheticFrames(N);
  const world = await serveImages(page, { frames, thumbDelayMs: 30 });
  // Turns on `window.__kestrelThumbs` (thumbs.ts): the loader's own admission-control count, read
  // directly instead of inferred from network timing (see the comment at the assertion below).
  await page.addInitScript(() => localStorage.setItem("kestrel.diagnostics", "1"));
  // Stamp the page's own fetch of the index, and the moment the caption first shows the total.
  await page.addInitScript(() => {
    const w = window as unknown as { __idx?: { asked?: number; shown?: number } };
    w.__idx = {};
    const orig = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/images/index") && w.__idx!.asked === undefined) w.__idx!.asked = performance.now();
      return orig(input, init);
    };
    new MutationObserver(() => {
      if (w.__idx!.shown !== undefined) return;
      // Merged reality (hooks reconciliation §a): the caption test id is `grid-caption`, not
      // `image-grid-caption` as the plan guessed.
      const cap = document.querySelector('[data-testid="grid-caption"]');
      if (cap && /of\s*20[,.\s\u202f]?000/.test(cap.textContent ?? "")) w.__idx!.shown = performance.now();
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });

  await page.goto(`/p/${P}/images`);
  const w = ws(page);
  await expect(w.gridCaption).toContainText(TOTAL, { timeout: 15_000 });
  const idx = await page.evaluate(
    () => (window as unknown as { __idx: { asked: number; shown: number } }).__idx,
  );
  const indexMs = Math.round(idx.shown - idx.asked);
  const indexLimitMs = info.config.metadata.frameBudget ? INDEX_BUDGET_MS : INDEX_STALL_MS;
  expect(indexMs, "index request to caption (ms)").toBeLessThanOrEqual(indexLimitMs);

  // Scroll top to bottom; at every step count thumbs in the whole DOM (ruling E6). Thumbnails are
  // fetched by FB's ThumbLoader and shown as `blob:` URLs, so `img[src*="/thumbnail"]` never
  // matches (hooks reconciliation §e "Task 8 (scale) specifics"). Count the grid tiles
  // (`image-thumb`) and the filmstrip's items (`Filmstrip.tsx`: `role=list aria-label="Filmstrip"`,
  // each frame a `role=listitem`) separately, and record their sum: the Filmstrip renders under the
  // canvas even in grid mode (`ImagesWorkspace.tsx`), so it is also "every thumbnail on the page".
  const thumbCounts = () =>
    page.evaluate(() => ({
      grid: document.querySelectorAll('[data-testid="image-thumb"]').length,
      filmstrip: document.querySelectorAll('[aria-label="Filmstrip"] [role="listitem"]').length,
      // The loader's own count (thumbs.ts's `ThumbLoader.inFlight`), sampled every step: the real,
      // structurally-bounded admission-control invariant the spec's "<= 8 in flight" is about.
      thumbsInFlight: window.__kestrelThumbs?.inFlight() ?? 0,
    }));
  let maxGrid = 0;
  let maxFilmstrip = 0;
  let maxLoaderInFlight = 0;
  const record = (c: { grid: number; filmstrip: number; thumbsInFlight: number }) => {
    maxGrid = Math.max(maxGrid, c.grid);
    maxFilmstrip = Math.max(maxFilmstrip, c.filmstrip);
    maxLoaderInFlight = Math.max(maxLoaderInFlight, c.thumbsInFlight);
  };
  record(await thumbCounts());
  const height = await w.grid.evaluate((el) => el.scrollHeight);
  for (let top = 0; top <= height; top += Math.ceil(height / 60)) {
    await w.grid.evaluate((el, t) => (el.scrollTop = t), top);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    record(await thumbCounts());
  }
  await w.grid.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(w.gridTiles.last()).toBeVisible();
  record(await thumbCounts());
  // The loader tracks its own true peak too (catches spikes between polls); take the higher of the
  // two as the number that matters.
  const loaderPeak = await page.evaluate(() => window.__kestrelThumbs?.peak() ?? 0);
  maxLoaderInFlight = Math.max(maxLoaderInFlight, loaderPeak);
  const maxThumbs = maxGrid + maxFilmstrip;
  // Budget (ruling (a)): every thumbnail on the page, grid + the always-mounted Filmstrip, stays
  // at most 60 in the DOM (spec §17 flow 7). Grid and filmstrip are also recorded separately above.
  expect(maxThumbs, "grid + filmstrip thumbs in the DOM").toBeLessThanOrEqual(60);
  // The real invariant (spec §15): the loader's own admission control, read via window.__kestrelThumbs
  // (thumbs.ts), never exceeds its 8-slot cap.
  expect(maxLoaderInFlight, "thumbnail loader's own in-flight count").toBeLessThanOrEqual(8);
  // Storm guard, not the primary budget (that's the loader's own count above, pinned exactly by
  // window.__kestrelThumbs): the mock's URL-deduped, abort-aware view of raw network requests can
  // still run a little ahead of the loader under this test's rapid teleport-scroll, from two
  // compounding, dev-only measurement artefacts (plan 2026-09-27-images-e Task 8 investigation) -
  // neither is a production bug, both verified against `thumbs.ts`'s source: (1) React StrictMode
  // (main.tsx, dev only) double-invokes each new tile batch's mount effect, asking the same URL
  // twice a few ms apart; (2) our scroll teleports faster (every rAF) than Playwright's
  // `requestfailed` reliably arrives over CDP, so a new batch's distinct URLs can start just before
  // the previous batch's abort is reported. 24 is a loose ceiling meant to catch an actual storm
  // (hundreds of requests) under a busy parallel gate, not to pin the exact observed peak - that
  // would make this assertion flaky for no safety benefit, since the real cap is pinned above.
  expect(world.maxThumbsInFlight, "thumbnail fetches in flight (network, storm guard)").toBeLessThanOrEqual(
    24,
  );
  expect(world.maxIdsPerList, "ids per listImages call").toBeLessThanOrEqual(200);

  // Jump to #15,000 (ruling E7).
  const target = frames[14_999];
  await page.goto(`/p/${P}/images/${target.id}`);
  await expect(w.canvas).toHaveAttribute("data-image", "4000x3000");
  await expect(w.statusBar).toContainText(/Image\s*15[,.\s\u202f]?000\s*\/\s*20[,.\s\u202f]?000/);
  await expect(w.currentTile).toBeInViewport();

  if (process.env.E2E_CAPTURE_EVIDENCE === "1")
    writeFileSync(
      evidencePath("images", "scale.json"),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          images: N,
          indexMs,
          maxThumbsGrid: maxGrid,
          maxThumbsFilmstrip: maxFilmstrip,
          maxThumbs,
          maxLoaderInFlight,
          maxThumbsInFlightNetwork: world.maxThumbsInFlight,
          maxIdsPerList: world.maxIdsPerList,
        },
        null,
        2,
      ) + "\n",
    );
});
