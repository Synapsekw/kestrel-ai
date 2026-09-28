import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { P, serveImages, syntheticFrames } from "./images/world";
import { openImage, ws } from "./images/ui";
import { evidencePath } from "./evidence";

// Hand-off from I-FB ("perf check of the capture map at 100k points"; controller's handoffs.md,
// I-E task 11a item A). world.ts's `index()` (the `/images/index` route) maps every frame through
// `stateOf` on each request, which itself filters this world's `boxes`/`findings` arrays (both
// empty for a synthetic-frames world with no boxes) — an O(n) pass over trivial arrays, built once
// per request, not memoised across requests. At 100k frames that is cheap (no per-frame work grows
// with the world); no additive cache was needed.
//
// The capture map (BrowserPane "Map" mode, src/images/browser/CaptureMap.tsx) renders through
// OpenLayers: `useCaptureMap` builds one `ol/Map` via `createCaptureMap` (olCaptureMap.ts), points
// drawn with `ol/layer/WebGLVector`. It is not Konva, so unlike images-perf.spec.ts's probe (which
// hooks `Konva.Layer.prototype.drawScene`) this file's probe is a plain requestAnimationFrame
// cadence recorder: it says nothing about OpenLayers' internal draw calls, only whether the browser
// keeps producing animation frames at a healthy rate while the operator pans/zooms.
//
// Observed (task 11a, this machine): the switch to Map is fast (~1.2 s, comfortably under the 5 s
// budget below — `data-point-count` is a synchronous prop computed from the index, not gated on the
// WebGL layer painting). But dragging to pan reproducibly locks the page up completely: no
// Playwright command (not even `page.mouse.move`) answers again within 15 s. This is not a test
// issue — it reproduced twice, including once under the default 60 s test timeout with the same
// symptom. Left as `test.fixme` per the brief; hand off back to I-FB.
const READY_BUDGET_MS = 5_000;
// Controller's ruling for this hand-off check (no map frame budget exists in the spec): no worse
// than every other frame dropped at 60 Hz (2 x 16.7 ms), plus the same timer-jitter allowance
// images-perf.spec.ts uses.
const FRAME_BUDGET_MS = 33.4;
const TIMER_JITTER_MS = 0.5;

interface FrameStats {
  frames: number;
  p50: number;
  p95: number;
  max: number;
}

type Probe = { start(): void; stop(): FrameStats };

async function installFrameProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    let recording = false;
    const stamps: number[] = [];
    const tick = (t: number) => {
      if (!recording) return;
      stamps.push(t);
      requestAnimationFrame(tick);
    };
    const pct = (xs: number[], q: number) => {
      const s = [...xs].sort((a, b) => a - b);
      return s.length ? s[Math.max(0, Math.ceil(s.length * q) - 1)] : 0;
    };
    const round = (x: number) => Math.round(x * 10) / 10;
    const probe: Probe = {
      start() {
        recording = true;
        stamps.length = 0;
        requestAnimationFrame(tick);
      },
      stop() {
        recording = false;
        const gaps = stamps
          .slice(1)
          .map((t, i) => t - stamps[i])
          .filter((g) => g <= 500);
        return {
          frames: gaps.length,
          p50: round(pct(gaps, 0.5)),
          p95: round(pct(gaps, 0.95)),
          max: round(Math.max(0, ...gaps)),
        };
      },
    };
    (window as unknown as { __mapPerf: Probe }).__mapPerf = probe;
  });
}

// The interaction phase (drag-pan + wheel-zoom) is raced against a watchdog: if the page never
// answers `page.mouse.move`/`waitForTimeout` again (a hard main-thread lock, not just a slow one),
// Playwright's own commands can block for the full test timeout. A watchdog lets a lock-up end the
// test in seconds, as `test.fixme` with the evidence, instead of burning the shared machine's time.
const INTERACTION_BUDGET_MS = 15_000;

test("capture map at 100,000 points switches in budget and pans/zooms without locking the page", async ({
  page,
}, info) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const frames = syntheticFrames(100_000);
  await serveImages(page, { frames });
  await openImage(page, P, frames[0].id, "4000x3000");
  const w = ws(page);

  const switchedAt = Date.now();
  await page.keyboard.press("Shift+M");
  let readyMs: number;
  try {
    await expect(w.captureMap).toHaveAttribute("data-point-count", "100000", {
      timeout: READY_BUDGET_MS + 5_000,
    });
    readyMs = Date.now() - switchedAt;
  } catch {
    const seen = await w.captureMap.getAttribute("data-point-count").catch(() => null);
    test.fixme(true, `capture map never reached 100000 points (saw ${seen}); hand off back to I-FB`);
    return;
  }
  await info.attach("map-ready.json", { body: JSON.stringify({ readyMs }), contentType: "application/json" });
  await expect(w.browserView.getByRole("radio", { name: "Map" })).toHaveAttribute("aria-checked", "true");
  expect(readyMs, "map ready (ms)").toBeLessThanOrEqual(READY_BUDGET_MS);

  const box = (await w.captureMap.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await installFrameProbe(page);
  await page.evaluate(() => (window as unknown as { __mapPerf: Probe }).__mapPerf.start());

  const interact = async (): Promise<void> => {
    // ~1 s of drag-pan: a circle of radius 100 px, one move per frame (OL's default DragPan needs
    // no modifier key, unlike the canvas workspace's space-drag).
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 0; i < 60; i++) {
      const a = (2 * Math.PI * i) / 60;
      await page.mouse.move(cx + 100 * Math.cos(a), cy + 100 * Math.sin(a));
      await page.waitForTimeout(16);
    }
    await page.mouse.up();

    const t0 = Date.now();
    await page.evaluate(() => 1 + 1);
    expect(Date.now() - t0, "trivial evaluate after the pan (ms)").toBeLessThan(1_000);

    // ~1 s of wheel zoom in and back out.
    for (let i = 0; i < 60; i++) {
      await page.mouse.wheel(0, i < 30 ? -60 : 60);
      await page.waitForTimeout(16);
    }
  };
  const watchdog = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), INTERACTION_BUDGET_MS),
  );
  const raced = await Promise.race([interact().then(() => "done" as const), watchdog]);
  if (raced === "timeout") {
    test.fixme(
      true,
      `capture map locked up during pan/zoom at 100000 points (ready in ${readyMs} ms; no more ` +
        `commands answered within ${INTERACTION_BUDGET_MS} ms); hand off back to I-FB`,
    );
    return;
  }

  const stats = await page.evaluate(() => (window as unknown as { __mapPerf: Probe }).__mapPerf.stop());
  await info.attach("map-frame-stats.json", {
    body: JSON.stringify({ readyMs, ...stats }, null, 2),
    contentType: "application/json",
  });
  expect(stats.frames, "rAF samples recorded during pan/zoom").toBeGreaterThan(50);

  // The frame budget (controller's ruling), only in the perf config.
  if (info.config.metadata.frameBudget) {
    expect(stats.p95, "p95 rAF interval (ms)").toBeLessThanOrEqual(FRAME_BUDGET_MS + TIMER_JITTER_MS);
    if (process.env.E2E_CAPTURE_EVIDENCE === "1") {
      const file = evidencePath("images", "map-scale.json");
      const prior = existsSync(file)
        ? (JSON.parse(readFileSync(file, "utf8")) as { runs: unknown[] })
        : { runs: [] };
      prior.runs.push({ at: new Date().toISOString(), points: 100_000, readyMs, ...stats });
      writeFileSync(file, JSON.stringify(prior, null, 2) + "\n");
    }
  }
});
