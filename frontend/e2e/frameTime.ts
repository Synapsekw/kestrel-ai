import type { Page } from "@playwright/test";

export interface FrameStats {
  samples: number;
  p50: number;
  p95: number;
  max: number;
}

/**
 * Frame-to-frame times with requestAnimationFrame, the app's own probe rules (frontend/src/app/
 * effects.ts measureFrames): skip `warmupMs`, drop gaps above 500 ms (a paused window, not a slow
 * frame); p95 is the sorted sample at min(n - 1, ceil(n * 0.95) - 1). The same numbers
 * e2e/effects.spec.ts reports, as a helper a scenario can run WHILE the test drives the mouse: start
 * it without awaiting, drive, then await it.
 */
export async function measureFrames(
  page: Page,
  { warmupMs = 300, durationMs = 2000 }: { warmupMs?: number; durationMs?: number } = {},
): Promise<FrameStats> {
  const deltas = await page.evaluate(
    ({ warmupMs, durationMs }) =>
      new Promise<number[]>((resolve) => {
        const MAX_FRAME_GAP_MS = 500;
        const out: number[] = [];
        let first: number | null = null;
        let last = 0;
        const tick = (time: number) => {
          if (first === null) first = time;
          else if (time - first > warmupMs && time - last <= MAX_FRAME_GAP_MS) out.push(time - last);
          last = time;
          if (time - first >= warmupMs + durationMs) resolve(out);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { warmupMs, durationMs },
  );
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)] ?? 0;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    samples: deltas.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted.at(-1) ?? 0),
  };
}

/** The page's own GPU facts (headless has no chrome://gpu). */
export async function pageEnvironment(page: Page) {
  return page.evaluate(() => {
    let renderer: string | null = null;
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      if (gl) {
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    } catch {
      renderer = null;
    }
    return {
      userAgent: navigator.userAgent,
      webglRenderer: renderer,
      hardwareConcurrency: navigator.hardwareConcurrency,
      viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
    };
  });
}
