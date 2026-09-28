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

/** rAF deltas while the mouse drags an orbit for `ms` (300 ms warm-up, gaps over 500 ms dropped). */
async function orbitDeltas(page: Page, ms: number): Promise<number[]> {
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
  const box = (await page.getByTestId("cloud-canvas").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const t0 = Date.now();
  for (let i = 0; Date.now() - t0 < ms; i += 1) {
    await page.mouse.move(cx + Math.sin(i / 20) * box.width * 0.3, cy + Math.cos(i / 35) * box.height * 0.05);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
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
  await expect.poll(async () => (await pinStates(page)).length, { timeout: 20_000 }).toBe(200);

  const raf = stats(await orbitDeltas(page, 5_000));
  const renders = await page.evaluate(() => window.__kestrelCloudViewer!.frameTimes());
  const render = stats(renders);
  const env = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      webglRenderer: ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null,
      viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
    };
  });
  const run = { at: new Date().toISOString(), ...env, pins: 200, raf, render };
  await test
    .info()
    .attach("frame-time.json", { body: JSON.stringify(run, null, 2), contentType: "application/json" });
  test.info().annotations.push({ type: "frame-time", description: JSON.stringify({ raf, render }) });

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
