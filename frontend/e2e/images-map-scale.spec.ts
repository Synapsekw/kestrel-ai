import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
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
// Observed (task 11a, controller-directed follow-up): switching to Map is always fast (~0.3-1.3s,
// comfortably under the 5s budget below — `data-point-count` is a synchronous prop off the index,
// not gated on the WebGL layer painting). Drag-pan is a different story **on this machine's headless
// Chromium**, which renders WebGL on SwiftShader (a software rasterizer;
// WEBGL_debug_renderer_info's UNMASKED_RENDERER_WEBGL reports "ANGLE (Google, Vulkan 1.3.0
// (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)") rather than a real GPU — unlike
// the shipped app, which runs in WebView2 with hardware acceleration. Bisecting the point count
// (throwaway probes, not committed): 1,000 completes normally; 5,000 completes but already ~3x
// slower than real time; 10,000 and up hard-locks the page (no Playwright command, not even
// `page.mouse.move`, answers again for 15s+). A CDP CPU profile at 5,000 points puts 69.4% of
// samples in `(program)` (native: GL driver / rasterizer / compositor, not attributable to JS) and
// every named JS function — ours, React's, OpenLayers' — at <=0.1% self-time each; nothing in
// `src/images/browser/*` stands out. Hover hit-testing is not the cause: `olCaptureMap.ts:157-159`
// (`map.on("pointermove", (e) => { if (!e.dragging) hover(e.pixel); })`) already skips hover
// whenever `e.dragging` is true, i.e. for the entire drag-pan interaction under test.
//
// Controller's ruling: this is a SwiftShader artefact until shown otherwise on real hardware — hand
// off to I-FB/IMC-X to check on the installed WebView2 build. So this file gates on the renderer:
// on software GL it skips only the drag-pan/zoom phase (and says so, loudly, in an annotation and in
// the evidence) rather than asserting something that measures the rasterizer, not the app; on
// hardware GL it runs the interaction with the watchdog and the perf-config frame budget as before.
//
// The 5 s ready budget is a machine-speed number, so like every other one in this suite (the frame
// budgets here and in images-perf.spec.ts) it holds only in the perf config (metadata.frameBudget,
// `pnpm -C frontend e2e:perf`). At 100k points the dev machine is ready in 1.4-1.7 s; the 4-vCPU CI
// runner took 7.1-10.8 s (runs 36413241109-36439794911, nearly all of it the page handling the
// Shift+M press) with no change to src/images/browser between those runs - the runner's speed, not
// a regression. The normal suite keeps the point count and a stall guard: loose enough for a slow
// runner, tight enough to catch a switch that never finishes or goes quadratic.
const READY_BUDGET_MS = 5_000;
const READY_STALL_MS = 30_000;
// Controller's ruling for this hand-off check (no map frame budget exists in the spec): no worse
// than every other frame dropped at 60 Hz (2 x 16.7 ms), plus the same timer-jitter allowance
// images-perf.spec.ts uses.
const FRAME_BUDGET_MS = 33.4;
const TIMER_JITTER_MS = 0.5;
// Same heuristic as src/app/effects.ts's `isSoftwareRenderer`, plus "software" and "llvmpipe"
// (Mesa's software rasterizer) themselves.
const SOFTWARE_RENDERER_RE = /swiftshader|basic render|software|llvmpipe/i;

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

/** `WEBGL_debug_renderer_info`'s UNMASKED_RENDERER_WEBGL, or a placeholder if WebGL is unavailable. */
async function rendererString(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return "no WebGL context";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  });
}

// The interaction phase (drag-pan + wheel-zoom) is raced against a watchdog: if the page never
// answers `page.mouse.move`/`waitForTimeout` again (a hard main-thread lock, not just a slow one),
// Playwright's own commands can block for the full test timeout. A watchdog lets a lock-up end the
// test in seconds instead of burning the shared machine's time.
const INTERACTION_BUDGET_MS = 15_000;

interface MapScaleOutcome {
  readyMs: number;
  renderer: string;
  /** True when the renderer is software GL and the pan/zoom phase was skipped entirely. */
  panSkipped: boolean;
  /** True when the pan/zoom phase ran but never returned within INTERACTION_BUDGET_MS. */
  locked: boolean;
  stats: FrameStats | null;
}

/**
 * Shared by the 20k and 100k tests below (controller's ruling on task 11a's review): switch to Map,
 * wait for `expectedCount` points, read the WebGL renderer, and — only on hardware GL — run ~1s of
 * drag-pan + ~1s of wheel-zoom while the frame probe records rAF cadence. On software GL (SwiftShader
 * et al) the pan/zoom phase is skipped and annotated instead: that phase would measure the
 * rasterizer, not the app (see the file header). Throws (failing the calling test) if the point
 * count is never reached; returns `{locked: true, stats: null}` if the interaction phase never
 * comes back within `INTERACTION_BUDGET_MS` (a hard main-thread lock even on hardware GL, not just
 * a slow one).
 */
async function measureCaptureMap(
  page: Page,
  w: ReturnType<typeof ws>,
  expectedCount: string,
  readyLimitMs: number,
): Promise<MapScaleOutcome> {
  const switchedAt = Date.now();
  await page.keyboard.press("Shift+M");
  await expect(w.captureMap).toHaveAttribute("data-point-count", expectedCount, {
    timeout: readyLimitMs + 5_000,
  });
  const readyMs = Date.now() - switchedAt;
  await expect(w.browserView.getByRole("radio", { name: "Map" })).toHaveAttribute("aria-checked", "true");

  const renderer = await rendererString(page);
  const noRenderer = renderer.trim().length === 0 || renderer === "no WebGL context";
  if (noRenderer || SOFTWARE_RENDERER_RE.test(renderer)) {
    test.info().annotations.push({
      type: "skip-pan",
      description: noRenderer
        ? `no usable WebGL renderer (saw "${renderer}") — treating as software GL; pan frame time ` +
          "cannot be measured"
        : "software GL (SwiftShader/llvmpipe) — pan frame time measures the rasterizer, not the app; " +
          "check on the installed build (IMC-X walkthrough)",
    });
    return { readyMs, renderer, panSkipped: true, locked: false, stats: null };
  }

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
  const interactPromise = interact();
  let watchdogTimer: ReturnType<typeof setTimeout>;
  const watchdog = new Promise<"timeout">((resolve) => {
    watchdogTimer = setTimeout(() => resolve("timeout"), INTERACTION_BUDGET_MS);
  });
  const raced = await Promise.race([interactPromise.then(() => "done" as const), watchdog]);
  clearTimeout(watchdogTimer!);
  if (raced === "timeout") {
    // The page may be main-thread-locked: `interactPromise` can stay pending indefinitely, or
    // eventually reject once the test/browser tears down (e.g. a `page.mouse.move` erroring on a
    // closed context). Either way this test has already moved on, so swallow it here rather than
    // let it surface as an unhandled rejection after the test ends.
    interactPromise.catch(() => undefined);
    return { readyMs, renderer, panSkipped: false, locked: true, stats: null };
  }

  const stats = await page.evaluate(() => (window as unknown as { __mapPerf: Probe }).__mapPerf.stop());
  return { readyMs, renderer, panSkipped: false, locked: false, stats };
}

/** Appends one run to docs/evidence/images/map-scale.json when E2E_CAPTURE_EVIDENCE=1. */
function recordEvidence(record: Record<string, unknown>): void {
  if (process.env.E2E_CAPTURE_EVIDENCE !== "1") return;
  const file = evidencePath("images", "map-scale.json");
  const prior = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as { runs: unknown[] })
    : { runs: [] };
  prior.runs.push({ at: new Date().toISOString(), ...record });
  writeFileSync(file, JSON.stringify(prior, null, 2) + "\n");
}

/**
 * The shared body for the 20k and 100k checks: open the workspace, switch to Map, and assert what
 * the current renderer can honestly measure (point count always; ready time against the budget in
 * the perf config, against a stall guard otherwise; pan/zoom frame health only on hardware GL — see
 * `measureCaptureMap`).
 */
async function runScaleCheck(page: Page, info: TestInfo, points: number): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  const frames = syntheticFrames(points);
  await serveImages(page, { frames });
  await openImage(page, P, frames[0].id, "4000x3000");
  const w = ws(page);

  const readyLimitMs = info.config.metadata.frameBudget ? READY_BUDGET_MS : READY_STALL_MS;
  const outcome = await measureCaptureMap(page, w, String(points), readyLimitMs);
  await info.attach(`map-${points}-outcome.json`, {
    body: JSON.stringify(outcome, null, 2),
    contentType: "application/json",
  });
  expect(outcome.readyMs, "map ready (ms)").toBeLessThanOrEqual(readyLimitMs);

  if (!outcome.panSkipped) {
    expect(outcome.locked, `capture map locked up during pan/zoom at ${points} points`).toBe(false);
    const stats = outcome.stats!;
    expect(stats.frames, "rAF samples recorded during pan/zoom").toBeGreaterThan(50);
    // The frame budget (controller's ruling), only in the perf config, only on hardware GL.
    if (info.config.metadata.frameBudget) {
      expect(stats.p95, "p95 rAF interval (ms)").toBeLessThanOrEqual(FRAME_BUDGET_MS + TIMER_JITTER_MS);
    }
  }

  recordEvidence({
    points,
    renderer: outcome.renderer,
    readyMs: outcome.readyMs,
    panSkipped: outcome.panSkipped,
    locked: outcome.locked,
    ...(outcome.stats ?? {}),
  });
}

test("capture map at 20,000 points reaches the point count within budget (pan/zoom on hardware GL only)", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await runScaleCheck(page, info, 20_000);
});

test("capture map at 100,000 points reaches the point count within budget (pan/zoom on hardware GL only)", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await runScaleCheck(page, info, 100_000);
});
