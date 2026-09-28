import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { heavyAnnotations, P, serveImages, syntheticFrames } from "./images/world";
import { ANNOTATION_LAYER, openImage, SUGGESTION_LAYER, ws } from "./images/ui";
import { evidencePath } from "./evidence";

// Spec §17 flow 6 and §18 item 8; rulings E3, E4. The structural proxy runs everywhere; the p95
// frame budget only under playwright.perf.config.ts (`pnpm -C frontend e2e:perf`), which sets
// metadata.frameBudget, on the dev machine with nothing else running Playwright.
const FRAME_BUDGET_MS = 16.7;
const TIMER_JITTER_MS = 0.5;

interface Stats {
  frames: number;
  p50: number;
  p95: number;
  max: number;
  annotationDraws: number;
  maxAnnotationDrawsPerFrame: number;
  hitDrawsDuringInput: number;
  sceneMsP95: number;
  layersFound: string[];
}

type Probe = { start(): void; inputDone(): void; stop(): Stats };

async function installProbe(page: Page): Promise<void> {
  await page.evaluate(
    ({ ann, sug }) => {
      type Node = { name(): string; getLayer(): Node | null };
      const K = (window as unknown as { Konva: any }).Konva; // eslint-disable-line @typescript-eslint/no-explicit-any
      const stage = K.stages.find((s: { container(): HTMLElement }) =>
        s.container().closest('[data-testid="image-canvas"]'),
      );
      if (!stage) throw new Error("no Konva stage inside image-canvas");
      const names: string[] = stage.getLayers().map((l: Node) => l.name());
      let frame = 0;
      let recording = false;
      let inputWindow = false;
      const stamps: number[] = [];
      const drawsPerFrame = new Map<number, number>();
      const sceneMs: number[] = [];
      let hitDuringInput = 0;
      const scene = K.Layer.prototype.drawScene;
      K.Layer.prototype.drawScene = function (this: Node, ...args: unknown[]) {
        if (!recording || this.name() !== ann) return scene.apply(this, args);
        const t0 = performance.now();
        const out = scene.apply(this, args);
        sceneMs.push(performance.now() - t0);
        drawsPerFrame.set(frame, (drawsPerFrame.get(frame) ?? 0) + 1);
        return out;
      };
      const hit = K.Shape.prototype.drawHit;
      K.Shape.prototype.drawHit = function (this: Node, ...args: unknown[]) {
        const layer = this.getLayer()?.name();
        if (inputWindow && (layer === ann || layer === sug)) hitDuringInput++;
        return hit.apply(this, args);
      };
      const tick = (t: number) => {
        if (!recording) return;
        stamps.push(t);
        frame++;
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
          inputWindow = true;
          requestAnimationFrame(tick);
        },
        inputDone() {
          inputWindow = false;
        },
        stop() {
          recording = false;
          const gaps = stamps
            .slice(1)
            .map((t, i) => t - stamps[i])
            .filter((g) => g <= 500);
          const counts = [...drawsPerFrame.values()];
          return {
            frames: gaps.length,
            p50: round(pct(gaps, 0.5)),
            p95: round(pct(gaps, 0.95)),
            max: round(Math.max(0, ...gaps)),
            annotationDraws: counts.reduce((a, b) => a + b, 0),
            maxAnnotationDrawsPerFrame: Math.max(0, ...counts),
            hitDrawsDuringInput: hitDuringInput,
            sceneMsP95: round(pct(sceneMs, 0.95)),
            layersFound: names,
          };
        },
      };
      (window as unknown as { __kPerf: Probe }).__kPerf = probe;
    },
    { ann: ANNOTATION_LAYER, sug: SUGGESTION_LAYER },
  );
}

test("500 annotations: at most one annotation draw per frame and no hit-graph rebuild while panning", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  const [frame] = syntheticFrames(1);
  await serveImages(page, { frames: [frame], boxes: { [frame.id]: heavyAnnotations(frame.id) } });
  const canvas = await openImage(page, P, frame.id, "4000x3000");
  await expect(ws(page).canvas).toHaveAttribute("data-shape-count", "500");
  await page.waitForTimeout(500); // let the first full draw and the image load settle
  await installProbe(page);

  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.evaluate(() => (window as unknown as { __kPerf: Probe }).__kPerf.start());
  // 1.5 s of drag-pan with Space held, a circle of radius 150 px, one move per frame.
  await page.keyboard.down(" ");
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 90; i++) {
    const a = (2 * Math.PI * i) / 90;
    await page.mouse.move(cx + 150 * Math.cos(a), cy + 150 * Math.sin(a));
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.keyboard.up(" ");
  // 1.5 s of wheel zoom in and back out.
  for (let i = 0; i < 90; i++) {
    await page.mouse.wheel(0, i < 45 ? -60 : 60);
    await page.waitForTimeout(16);
  }
  await page.evaluate(() => (window as unknown as { __kPerf: Probe }).__kPerf.inputDone());
  await page.waitForTimeout(300); // listening comes back (spec §9.1: 120 ms); outside the window
  const stats = await page.evaluate(() => (window as unknown as { __kPerf: Probe }).__kPerf.stop());

  await info.attach("frame-stats.json", {
    body: JSON.stringify(stats, null, 2),
    contentType: "application/json",
  });
  // Review Focus 5: the probe measured something real.
  expect(stats.layersFound).toEqual(expect.arrayContaining([ANNOTATION_LAYER, SUGGESTION_LAYER]));
  expect(stats.annotationDraws).toBeGreaterThan(10);
  expect(stats.frames).toBeGreaterThan(100);
  // The structural proxy (ruling E4): CI-safe, independent of the machine's speed.
  expect(stats.maxAnnotationDrawsPerFrame).toBeLessThanOrEqual(1);
  expect(stats.hitDrawsDuringInput).toBe(0);
  // The frame budget (ruling E3), only in the perf config.
  if (info.config.metadata.frameBudget) {
    expect(stats.p95, "p95 rAF interval (ms)").toBeLessThanOrEqual(FRAME_BUDGET_MS + TIMER_JITTER_MS);
    if (process.env.E2E_CAPTURE_EVIDENCE === "1") {
      const file = evidencePath("images", "frame-time.json");
      const prior = existsSync(file)
        ? (JSON.parse(readFileSync(file, "utf8")) as { runs: unknown[] })
        : { runs: [] };
      const env = await page.evaluate(() => ({
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
      }));
      prior.runs.push({ at: new Date().toISOString(), ...env, annotations: 500, ...stats });
      writeFileSync(file, JSON.stringify(prior, null, 2) + "\n");
    }
  }
});
