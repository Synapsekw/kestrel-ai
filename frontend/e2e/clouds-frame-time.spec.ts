import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { CLOUD } from "./fixtures/clouds";
import { gridPins, serveCloudWorld } from "./fixtures/cloudWorld";
import { P, SWIFTSHADER, diagnosticsOn, pinStates, viewerSettled } from "./fixtures/cloudWorkspace";
import { evidencePath } from "./evidence";

// §15 item 13: a scripted orbit with 200 pins, measured the way F's probe measures
// (frontend/e2e/effects.spec.ts). Reported on SwiftShader, never asserted there: headless paces rAF at
// 60 Hz and WebGL runs on the CPU, so a budget would measure the machine. The real-GPU run is the
// acceptance driver's (docs/evidence/clouds/README.md, "Performance").
test.use(SWIFTSHADER);
test.beforeEach(async ({ page }) => diagnosticsOn(page));

interface Stats {
  samples: number;
  p50: number;
  p95: number;
  max: number;
}

function stats(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)] ?? 0;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    samples: sorted.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted.at(-1) ?? 0),
  };
}

/** Euclidean distance between two `[x, y, z]` points (matches `clouds-engine-v2.spec.ts`'s `dist`). */
const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Browser rAF deltas measured over `ms` while the engine's own `scriptOrbit()` (spec §7 diagnostics
 * hook, already exercised by `clouds-engine.spec.ts` "frame times fill during an orbit") turns the
 * camera continuously (300 ms warm-up, gaps over 500 ms dropped).
 *
 * Fix round 1 (review): the original harness dragged the mouse from the canvas's own centre pixel.
 * With 200 pins on screen (`gridPins(200)`), that pixel — and several others tried nearby — landed on
 * a pin's DOM element (`kp-pin-drop`/`kp-pin-head`, `pinsController.ts`) or a docked panel instead of
 * the bare `<canvas>`: `document.elementFromPoint` at the drag's start confirmed this. Pins intercept
 * the pointer before three.js's `OrbitControls` (which listens on the canvas element itself) ever sees
 * it, so `pointerdown` never reached the controls and the camera silently never moved — exactly Review
 * Focus item 4 ("the drag never moved the camera"), just not caught because the original test never
 * checked `cameraPose()`. `scriptOrbit()` drives the camera directly (`engine.ts`'s `orbitScript`
 * stepping `camera.position` every tick), so the measurement no longer depends on which pixel happens
 * to be clickable. `orbit = false` is RED-proof only (no camera motion at all): never used by the real
 * test.
 */
async function orbitDeltas(page: Page, ms: number, orbit = true): Promise<number[]> {
  await page.evaluate(() => {
    const w = window as unknown as { __deltas: number[]; __on: boolean };
    w.__deltas = [];
    w.__on = true;
    let first: number | null = null;
    let last = 0;
    const tick = (t: number) => {
      if (first === null) first = t;
      else if (t - first > 300 && t - last <= 500) w.__deltas.push(t - last);
      last = t;
      if (w.__on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  if (orbit) {
    await page.evaluate((s) => window.__kestrelCloudViewer!.scriptOrbit(s), ms / 1000);
  } else {
    await page.waitForTimeout(ms); // RED-proof only: no scripted orbit, so the camera never moves
  }
  return page.evaluate(() => {
    const w = window as unknown as { __deltas: number[]; __on: boolean };
    w.__on = false;
    return w.__deltas;
  });
}

test("frame-time harness: a scripted orbit with 200 pins (reported, not asserted)", async ({ page }) => {
  test.setTimeout(90_000);
  await serveCloudWorld(page, { findings: gridPins(200) });
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);
  const pinCount = async () => (await pinStates(page)).length;
  await expect.poll(pinCount, { timeout: 20_000 }).toBe(200);
  const pins = await pinCount();

  // Fix round 1 (review): `raf.samples` alone proves nothing — the local rAF tick loop below runs
  // on the browser's own clock whether or not the camera moves. `frameTimes()` reads V1's FrameRing
  // (frontend/src/clouds/viewer/frameRing.ts), which is never cleared, so a non-empty `frameTimes()`
  // is equally satisfied by load-phase frames alone. Record the pose and the ring length *before* the
  // orbit, then require the pose to have actually moved and the ring to have grown, and score `render`
  // only over the orbit-window tail. FrameRing's capacity is 600 (frameRing.ts `FRAME_RING_SIZE`); 5 s
  // at 60 Hz is at most ~300 pushes, comfortably under the cap, so the ring cannot wrap mid-orbit and
  // the tail-by-length-diff below is not corrupted by wrap-around.
  const poseBefore = await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose()!);
  const renderCountBefore = await page.evaluate(() => window.__kestrelCloudViewer!.frameTimes().length);

  const raf = stats(await orbitDeltas(page, 5_000));

  const poseAfter = await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose()!);
  const rendersAll = await page.evaluate(() => window.__kestrelCloudViewer!.frameTimes());
  const renders = rendersAll.slice(renderCountBefore);
  const render = stats(renders);
  const env = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      webglRenderer: ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null,
      viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
    };
  });
  const run = { at: new Date().toISOString(), ...env, pins, raf, render };
  await test
    .info()
    .attach("frame-time.json", { body: JSON.stringify(run, null, 2), contentType: "application/json" });
  test.info().annotations.push({ type: "frame-time", description: JSON.stringify({ raf, render }) });

  // an orbit really happened: the camera moved, and the render ring grew during the orbit window
  expect(dist(poseAfter.position, poseBefore.position), "the orbit must move the camera").toBeGreaterThan(
    0.01,
  );
  expect(
    renders.length,
    "the render ring must grow during the orbit, not just during load",
  ).toBeGreaterThanOrEqual(30);
  // real samples, not an empty window
  expect(raf.samples).toBeGreaterThanOrEqual(60);
  expect(render.samples).toBeGreaterThan(0);
  expect(renders.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);

  if (process.env.E2E_CAPTURE_EVIDENCE === "1") {
    const path = evidencePath("clouds", "frame-time-swiftshader.json");
    const doc = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as { runs: unknown[] })
      : { runs: [] };
    doc.runs.push(run);
    writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  }
});
