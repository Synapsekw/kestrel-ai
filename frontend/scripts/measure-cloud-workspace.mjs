// The point-cloud workspace's acceptance and performance driver (C-G; spec sections 13 and 16). Run by
// run-dev-cloud-acceptance.ps1 (dev mode, Edge over CDP) or check-packaged-webview.ps1 -Driver (the
// packaged exe). KESTREL_MODE: layout | perf | pins | pins-check | clip | photolink | image2cloud |
// formulas | hold. Results go to KESTREL_OUT as JSON; screenshots to KESTREL_SHOTS. The token is read
// from KESTREL_TOKEN and never written to either.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  coverageCounts,
  frameStats,
  insideClipBox,
  pinGrid,
  profileTotals,
  ringTail,
} from "./cloud-perf-lib.mjs";
import { ui } from "./cloud-ui.mjs";

const env = process.env;
const mode = env.KESTREL_MODE ?? "perf";
const effects = env.KESTREL_EFFECTS ?? "full";
const out = env.KESTREL_OUT ?? path.join(env.KESTREL_WORK_DIR, "out", `${mode}-${effects}.json`);
const shots = env.KESTREL_SHOTS ?? path.join(env.KESTREL_WORK_DIR, "out");
/** Ruling G5: the functions whose profiled time is the pin pass, the occlusion pass and the hover pick
 * (C-G Task 1 Step 5's names; override with KESTREL_FN_PINS etc.). The pin pass is not Task 1's
 * `projectPins`: the app never calls it (tests only); the per-frame pass is PinsLayerController.frame
 * (pins/pinsController.ts, the span its own lastPassMs times), hence "frame@pinsController". */
const FN = {
  pins: (env.KESTREL_FN_PINS ?? "frame@pinsController").split(","),
  occlusion: (env.KESTREL_FN_OCCLUSION ?? "runOcclusion@PinsLayer").split(","),
  hover: (env.KESTREL_FN_HOVER ?? "pickAtClient").split(","),
};
/** The occlusion pass per settle is the pins layer's `runOcclusion` (pins/PinsLayer.tsx: the settle
 * callback, one call per settle); the engine's implementation of the same name (viewer/occlusion.ts,
 * which answers null while the view moves) is recorded beside it. */
const OCC_ENGINE = "runOcclusion@viewer/occlusion";
/** Driver pins for `perf` (§13: pin pass ≤ 1 ms at 200, ≤ 2.5 ms at 500). */
const PIN_COUNT = Number(env.KESTREL_PIN_COUNT ?? 200);
const PERF_NOTE = "C-G perf pin";
const MOCKUP =
  env.KESTREL_MOCKUP ??
  "E:\\Dev\\Yolo\\app\\.superpowers\\brainstorm\\1481982-1790403567\\content\\ws-clouds.html";
/** The orbit windows (ms): frame times without the profiler, then the pin pass with it. */
const ORBIT_MS = Number(env.KESTREL_ORBIT_MS ?? 10_000);
const PROFILED_ORBIT_MS = Number(env.KESTREL_PROFILED_ORBIT_MS ?? 5_000);
/** A chunk short enough that the 600-frame ring cannot wrap past a read (2 s at 240 Hz is 480). */
const CHUNK_MS = 2_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (why) => {
  console.log(`measure FAIL ${why}`);
  process.exit(1);
};
/** A metric that could not be measured (a zero total or call count would read as a pass): the JSON
 * is still written, with `problems`, and the driver exits 1. */
const problems = [];
const problem = (why) => {
  console.log(`measure PROBLEM ${why}`);
  problems.push(why);
};
const api = async (p, init = {}) => {
  const r = await fetch(`${env.KESTREL_BACKEND_URL}/api/v1/projects/${env.KESTREL_PROJECT_ID}${p}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.KESTREL_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};
/** Every finding on this cloud (keyset pages of 500). */
async function listFindings() {
  const found = [];
  let cursor = null;
  do {
    const next = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const r = await api(`/findings?data_id=${env.KESTREL_CLOUD_ID}&limit=500${next}`);
    if (r.status !== 200) fail(`listFindings ${r.status}`);
    found.push(...r.body.items);
    cursor = r.body.next_cursor ?? null;
  } while (cursor);
  return found;
}
/** CPU profile and call counts over `fn` (precise coverage is reset first, so it counts this window). */
async function profiled(cdp, fn) {
  await cdp.send("Profiler.startPreciseCoverage", { callCount: true, detailed: false });
  await cdp.send("Profiler.takePreciseCoverage");
  await cdp.send("Profiler.start");
  const value = await fn();
  const profile = (await cdp.send("Profiler.stop")).profile;
  const coverage = await cdp.send("Profiler.takePreciseCoverage");
  await cdp.send("Profiler.stopPreciseCoverage");
  return { value, profile, coverage };
}
const hypot3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

/** The browser's working set (every process of this profile), sampled by one long-lived PowerShell
 * every 500 ms: one process for the whole run, not one per sample, so sampling does not load the CPU
 * the frame times are measured on. */
function memorySampler() {
  const dir = env.KESTREL_WEBVIEW_DIR.replace(/'/g, "''");
  const name = env.KESTREL_BROWSER_PROCESS ?? "msedgewebview2.exe";
  const ps =
    `while ($true) { $p = @(Get-CimInstance Win32_Process -Filter "Name='${name}'" | Where-Object { $_.CommandLine -like '*${dir}*' }); ` +
    `[Console]::Out.WriteLine("$($p.Count) $(($p | Measure-Object -Property WorkingSetSize -Sum).Sum)"); Start-Sleep -Milliseconds 500 }`;
  const child = spawn("powershell", ["-NoProfile", "-Command", ps], { stdio: ["ignore", "pipe", "ignore"] });
  const m = { peakBytes: 0, samples: 0, processes: 0 };
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) {
      const [count, bytes] = line.trim().split(/\s+/).map(Number);
      if (!Number.isFinite(bytes)) continue;
      m.samples += 1;
      if (bytes > m.peakBytes) m.peakBytes = bytes;
      m.processes = Math.max(m.processes, count || 0);
    }
  });
  return {
    stop() {
      child.kill();
      return m;
    },
  };
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${env.KESTREL_CDP_PORT}`);
const context = browser.contexts()[0];
const appPage = () =>
  context.pages().find((p) => /^http:\/\/(127\.0\.0\.1|localhost|tauri\.localhost)/.test(p.url())) ??
  context.pages()[0];
let page = appPage();
for (let i = 0; !page && i < 100; i += 1) {
  await sleep(100);
  page = appPage();
}
if (!page) fail("no page");
// Count the page's own requestAnimationFrame calls (the idle check, as the e2e fixture does); the
// driver's timers use the original, so they are not counted.
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__rafOrig = raf;
  window.__rafCalls = 0;
  window.requestAnimationFrame = (cb) => {
    window.__rafCalls += 1;
    return raf(cb);
  };
});
/** page.evaluate that waits out a navigation (Vite's dependency optimiser reloads the page once
 * when it finds a new import; the first load can still be settling): retried, else `fallback`. */
async function evalSafe(fn, arg, fallback = null, tries = 50) {
  for (let i = 0; i < tries; i += 1) {
    try {
      return await page.evaluate(fn, arg);
    } catch (e) {
      if (!/Execution context was destroyed|navigation|Target closed/.test(String(e))) throw e;
      await sleep(200);
    }
  }
  return fallback;
}
await page.waitForFunction(() => document.readyState === "complete", null, { timeout: 60_000 });
await evalSafe(
  ([budget, fx, clipKey, keepClip]) => {
    localStorage.setItem("kestrel.diagnostics", "1");
    localStorage.setItem("kestrel.clouds.pointBudget", String(budget));
    localStorage.setItem("kestrel.effects", fx);
    // a clip box a previous `clip` run left would thin every later measurement (clip.ts clipKey)
    if (!keepClip) localStorage.removeItem(clipKey);
  },
  [Number(env.KESTREL_BUDGET), effects, `kestrel.clouds.clip.${env.KESTREL_CLOUD_ID}`, mode === "hold"],
);
await page.reload();
await page.waitForFunction(() => document.readyState === "complete", null, { timeout: 60_000 });
const w = ui(page);
const cloud = (await api(`/pointclouds/${env.KESTREL_CLOUD_ID}`)).body;
if (!cloud?.id) fail(`no cloud ${env.KESTREL_CLOUD_ID}`);
const go = (search = "") =>
  page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate"));
  }, `/p/${env.KESTREL_PROJECT_ID}/clouds/${env.KESTREL_CLOUD_ID}${search}`);
const stats = () => evalSafe(() => window.__kestrelCloudViewer?.stats() ?? null, undefined, null, 5);
const pins = () => evalSafe(() => window.__kestrelCloudViewer?.pins?.() ?? [], undefined, [], 5);
const pose = () => page.evaluate(() => window.__kestrelCloudViewer?.cameraPose() ?? null);
const ring = () => page.evaluate(() => window.__kestrelCloudViewer?.frameTimes() ?? []);
async function settle(timeoutMs = 60_000) {
  const t0 = Date.now();
  let s = null;
  let quietSince = null;
  while (Date.now() - t0 < timeoutMs) {
    s = await stats();
    const quiet = s && s.numVisiblePoints > 0 && s.nodesLoading === 0;
    quietSince = quiet ? (quietSince ?? Date.now()) : null;
    if (quietSince && Date.now() - quietSince > 1500) return s;
    await sleep(100);
  }
  return s;
}
async function arrive(search) {
  await go(search);
  await settle();
  await sleep(3000); // the arrival's Z refine and tween
  return settle();
}
async function canvasCentre() {
  const b = await w.canvas.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
}
/** The nearest client point to (x, y) whose top element is the canvas itself: a pin's DOM node or a
 * docked panel there would take the pointer before the viewer sees it (C-G Task 5's finding). Null
 * when none within `radius` px. */
async function clearPoint(x, y, radius = 200) {
  return page.evaluate(
    ([x0, y0, r]) => {
      const canvas = document.querySelector('[data-testid="cloud-canvas"]');
      if (!canvas) return null;
      const ok = (x, y) => document.elementFromPoint(x, y) === canvas;
      if (ok(x0, y0)) return { x: x0, y: y0 };
      for (let d = 8; d <= r; d += 8)
        for (let k = 0; k < 16; k += 1) {
          const a = (k / 16) * 2 * Math.PI;
          const x = x0 + d * Math.cos(a);
          const y = y0 + d * Math.sin(a);
          if (ok(x, y)) return { x, y };
        }
      return null;
    },
    [x, y, radius],
  );
}
/** Browser frames (rAF deltas, ≤ 500 ms, from the original rAF) while `fn` runs. */
async function rafWindow(fn) {
  await page.evaluate(() => {
    const raf = window.__rafOrig ?? window.requestAnimationFrame.bind(window);
    window.__d = [];
    window.__on = true;
    let last = null;
    const tick = (t) => {
      if (last !== null && t - last <= 500) window.__d.push(t - last);
      last = t;
      if (window.__on) raf(tick);
    };
    raf(tick);
  });
  await fn();
  return page.evaluate(() => {
    window.__on = false;
    return window.__d;
  });
}
const moved = (a, b) => (a && b ? hypot3(a.position, b.position) + hypot3(a.target, b.target) : 0);

/**
 * An orbit of `ms`, in chunks of CHUNK_MS with the render ring read between them (ringTail), so the
 * render frame times are the orbit window's only. `input` "mouse" drags from a canvas point clear of
 * pins and panels; "script" is the hook's scriptOrbit. The pose before and after proves the camera
 * moved.
 */
async function orbit(ms, input) {
  const c = await canvasCentre();
  const start = input === "mouse" ? await clearPoint(c.x, c.y, Math.min(c.w, c.h) * 0.4) : null;
  if (input === "mouse" && !start) return null;
  const p0 = await pose();
  const raf = [];
  const render = [];
  let exact = true;
  let before = await ring();
  if (start) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
  }
  let i = 0;
  for (let done = 0; done < ms; done += CHUNK_MS) {
    const chunk = Math.min(CHUNK_MS, ms - done);
    const d = await rafWindow(async () => {
      if (start) {
        const t0 = Date.now();
        while (Date.now() - t0 < chunk) {
          await page.mouse.move(
            start.x + Math.sin(i / 20) * c.w * 0.3,
            start.y + Math.cos(i / 35) * c.h * 0.05,
          );
          i += 1;
          await sleep(16);
        }
      } else await page.evaluate((s) => window.__kestrelCloudViewer.scriptOrbit(s), chunk / 1000);
    });
    raf.push(...d);
    const after = await ring();
    const t = ringTail(before, after, d.length);
    exact &&= t.exact;
    render.push(...t.tail);
    before = after;
  }
  if (start) await page.mouse.up();
  const p1 = await pose();
  return { input, start, raf, render, ringExact: exact, cameraMoved: moved(p0, p1) };
}
/** The drag from a clear canvas point; the script orbit when none exists, when the drag did not move
 * the camera, or when `prefer` is "script" (KESTREL_ORBIT_INPUT=script). `orbitInput` records which. */
async function measuredOrbit(ms, prefer) {
  if (prefer !== "script") {
    const o = await orbit(ms, "mouse");
    if (o && o.cameraMoved > 1e-3) return o;
    await settle();
  }
  return orbit(ms, "script");
}
/** A cloud finding at each XY on the cloud's surface there (pickDown), else at mid-height. */
async function createPins(n) {
  const b = cloud.bounds_native;
  const made = [];
  for (const [i, [x, y]] of pinGrid(b, n).entries()) {
    const hit = await page.evaluate(([px, py]) => window.__kestrelCloudViewer.pickDown(px, py, 2), [x, y]);
    const anchor = {
      kind: "cloud",
      cloud_id: env.KESTREL_CLOUD_ID,
      x,
      y,
      z: hit ? hit.z : (b[2] + b[5]) / 2,
      uncertainty_m: hit ? hit.uncertainty_m : 0.1,
    };
    const r = await api("/findings", {
      method: "POST",
      body: JSON.stringify({
        type_id: env.KESTREL_CRACK_TYPE,
        severity: (i % 4) + 1,
        anchor,
        note: PERF_NOTE,
      }),
    });
    if (r.status !== 201) fail(`createFinding ${r.status} ${JSON.stringify(r.body)}`);
    made.push(r.body.id);
  }
  return made;
}
/**
 * A PNG of the page's viewport straight from CDP's Page.captureScreenshot. Playwright's
 * page.screenshot on a headful Edge attached over CDP repeats the top ~34 px at the bottom of the
 * image (seen in the Task 9 smoke run with a plain gradient page; the raw capture is correct).
 */
async function shot(pg, file) {
  const s = await context.newCDPSession(pg);
  const { data } = await s.send("Page.captureScreenshot", { format: "png" });
  await s.detach();
  fs.writeFileSync(file, Buffer.from(data, "base64"));
}
/** Running CSS/Web animations, as the e2e fixture counts them (runningAnimations): not infinite ones,
 * not the hint bar's fade. */
const runningAnimations = () =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .filter((a) => a.effect?.getTiming().iterations !== Infinity)
      .filter((a) => !a.effect?.target?.closest?.('[data-testid="cloud-hintbar"]'))
      .map(
        (a) =>
          `${a.effect?.target?.tagName?.toLowerCase() ?? "?"}: ${a.animationName ?? a.id ?? "animation"}`,
      ),
  );

const result = {
  mode,
  effects,
  budget: Number(env.KESTREL_BUDGET),
  cloud: { id: cloud.id, points: cloud.point_count },
  build:
    env.KESTREL_BROWSER_PROCESS === "msedge.exe" ? "dev mode (Vite), Microsoft Edge over CDP" : "packaged",
};
result.browser = await page.evaluate(() => navigator.userAgent);
result.gpu = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
});

if (mode === "layout") {
  await go();
  await settle();
  await sleep(1500); // the panels' entrances
  const vp = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const appShot = path.join(shots, "layout-app.png");
  await shot(page, appShot);
  const boxes = {};
  for (const [name, loc] of Object.entries({
    rail: w.rail,
    railPanel: w.railPanel,
    minimap: w.minimap,
    readout: w.readout,
    viewport: w.viewport,
  }))
    boxes[name] = await loc.boundingBox({ timeout: 2000 }).catch(() => null);
  result.viewport = vp;
  result.panels = boxes;
  if (fs.existsSync(MOCKUP)) {
    const mock = await context.newPage();
    await mock.setViewportSize(vp);
    await mock.goto(pathToFileURL(MOCKUP).href);
    await sleep(1500);
    const mockShot = path.join(shots, "layout-mockup.png");
    await shot(mock, mockShot);
    const sbs = await context.newPage();
    await sbs.setViewportSize({ width: vp.width * 2 + 8, height: vp.height });
    const b64 = (f) => fs.readFileSync(f).toString("base64");
    await sbs.setContent(
      `<body style="margin:0;display:flex;gap:8px;background:#000"><img src="data:image/png;base64,${b64(appShot)}"><img src="data:image/png;base64,${b64(mockShot)}"></body>`,
    );
    await shot(sbs, path.join(shots, "layout-side-by-side.png"));
    await mock.close();
    await sbs.close();
    result.mockup = MOCKUP;
  } else result.mockup = null; // G12: the mockup lives in the main checkout only
}

if (mode === "perf") {
  await go();
  await settle();
  // PIN_COUNT driver pins (note PERF_NOTE; §13 has targets at 200 and 500): create the missing ones,
  // delete the driver's surplus from an earlier run with a larger count; other findings are kept.
  const all = await listFindings();
  const ours = all.filter((f) => f.note === PERF_NOTE);
  if (ours.length < PIN_COUNT) await createPins(PIN_COUNT - ours.length);
  for (const f of ours.slice(PIN_COUNT)) {
    const r = await api(`/findings/${f.id}`, { method: "DELETE" });
    if (r.status >= 300) fail(`deleteFinding ${r.status}`);
  }
  const expectedPins = all.length - ours.length + PIN_COUNT;
  result.pinCount = PIN_COUNT;
  const memory = memorySampler();

  // a cold open (finding 3): the HTTP cache cleared and disabled, then a full page load, so no octree
  // node comes from memory or from the persistent cache in <Work>\edge (S1 measured its first open).
  // The OS file cache on the backend side cannot be cleared from here.
  const net = await context.newCDPSession(page);
  await net.send("Network.enable");
  await net.send("Network.clearBrowserCache");
  await net.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.goto(new URL(`/p/${env.KESTREL_PROJECT_ID}/clouds/${env.KESTREL_CLOUD_ID}`, page.url()).href);
  let s = await settle();
  for (let i = 0; i < 100 && s && s.settledMs == null; i += 1) {
    await sleep(100);
    s = await stats();
  }
  await net.send("Network.setCacheDisabled", { cacheDisabled: false });
  result.open = { warm: false, httpCacheCleared: true };
  result.firstPointsMs = s?.firstPointsMs ?? null;
  result.settledMs = s?.settledMs ?? null;
  result.visiblePoints = s?.numVisiblePoints ?? null;
  if (result.firstPointsMs == null || result.settledMs == null) problem("open: no firstPointsMs/settledMs");
  for (let i = 0; i < 150 && (await pins()).length < expectedPins; i += 1) await sleep(200);
  const rows = await pins();
  result.pins = rows.length;
  result.pinsVisible = rows.filter((p) => p.state === "visible").length;
  if (rows.length !== expectedPins) problem(`pins: ${rows.length} drawn, ${expectedPins} expected`);
  await w.openTopic("Layers");
  if (effects === "full" && (await w.edl.getAttribute("aria-checked")) !== "true") await w.edl.click();
  result.edl = (await w.edl.getAttribute("aria-checked")) === "true";
  await w.openTopic("Findings"); // the rail panel on Findings, cameras as they default
  await settle();

  // orbit, no profiler attached: the frame times (spec §13 orbit p50/p95). The page's own rAF calls
  // must grow here: the positive control for the idle check below (minor m2).
  const rafCalls = () => page.evaluate(() => window.__rafCalls);
  const calls0 = await rafCalls();
  const o = await measuredOrbit(ORBIT_MS, env.KESTREL_ORBIT_INPUT ?? "mouse");
  result.orbitRafCalls = (await rafCalls()) - calls0;
  result.orbitInput = o.input;
  result.orbitStart = o.start;
  result.orbitCameraMoved = +o.cameraMoved.toFixed(3);
  result.orbitRaf = frameStats(o.raf);
  result.orbitRender = frameStats(o.render);
  result.orbitRenderRingExact = o.ringExact;
  if (o.cameraMoved <= 1e-3) fail(`the orbit did not move the camera (${o.input})`);
  if (o.raf.length < 60 || o.render.length === 0)
    fail(`orbit samples raf=${o.raf.length} render=${o.render.length}`);
  if (result.orbitRafCalls <= 0) fail("the page made no rAF call during the orbit (idle control)");
  await settle();

  // orbit again under the CPU profiler and call counting (G5: 100 us sampling, an estimate): the pin
  // pass per frame it ran in, and nothing of the occlusion pass or the hover pick while moving (m3).
  // The pins layer's own timer (PinDiag.passMs, the same span) is sampled alongside (m1).
  const cdp = await context.newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  const passSamples = [];
  let sampling = true;
  const passSampler = (async () => {
    while (sampling) {
      const v = await page.evaluate(() => window.__kestrelCloudViewer?.pins?.()[0]?.passMs ?? null);
      if (typeof v === "number" && Number.isFinite(v)) passSamples.push(v);
      await sleep(50);
    }
  })();
  const po = await profiled(cdp, () => measuredOrbit(PROFILED_ORBIT_MS, o.input));
  sampling = false;
  await passSampler;
  const pinMs = sum(profileTotals(po.profile, FN.pins));
  const pinRuns = sum(coverageCounts(po.coverage, FN.pins));
  result.pinPass = {
    measured: pinMs > 0 && pinRuns > 0,
    totalMs: +pinMs.toFixed(3),
    framesRan: pinRuns,
    ringFrames: po.value.render.length,
    msPerFrame: pinRuns ? +(pinMs / pinRuns).toFixed(4) : null,
    hookPassMs: frameStats(passSamples),
  };
  if (!result.pinPass.measured) problem(`pin pass: ${FN.pins} total ${pinMs} ms over ${pinRuns} calls`);
  result.duringOrbit = {
    occlusionMs: +sum(profileTotals(po.profile, [...FN.occlusion, OCC_ENGINE])).toFixed(3),
    occlusionCalls: sum(coverageCounts(po.coverage, FN.occlusion)),
    hoverPickCalls: sum(coverageCounts(po.coverage, FN.hover)),
  };

  // one settle under the profiler (finding 2): profiling and counting start first, then a short
  // scripted turn makes the view move and settle again, so the settle's occlusion pass lands inside
  // the window (the viewer calls it IDLE_AFTER_MS = 1 s after the last frame).
  const occ = await profiled(cdp, async () => {
    await page.evaluate(() => window.__kestrelCloudViewer.scriptOrbit(0.2));
    await settle();
    await sleep(2500);
  });
  const occMs = sum(profileTotals(occ.profile, FN.occlusion));
  const occCalls = sum(coverageCounts(occ.coverage, FN.occlusion));
  result.occlusion = {
    measured: occMs > 0 && occCalls > 0,
    totalMs: +occMs.toFixed(3),
    calls: occCalls,
    msPerSettle: occCalls ? +(occMs / occCalls).toFixed(3) : null,
    engineMs: +sum(profileTotals(occ.profile, [OCC_ENGINE])).toFixed(3),
  };
  if (!result.occlusion.measured)
    problem(`occlusion: ${FN.occlusion} total ${occMs} ms over ${occCalls} calls`);
  // cross-check: the hook's own timed occlusion over the same shown pins (CloudViewer.tsx occlusion)
  const shown = new Set((await pins()).filter((p) => p.state !== "hidden").map((p) => p.id));
  const pts = (await listFindings())
    .filter((f) => shown.has(f.id))
    .map((f) => [f.anchor.x, f.anchor.y, f.anchor.z]);
  const hook = await page.evaluate(
    ([p]) =>
      window.__kestrelCloudViewer.occlusion(
        p,
        p.map(() => 0.3),
      ),
    [pts],
  );
  result.occlusion.hook = { pins: pts.length, ms: +hook.ms.toFixed(3), settled: hook.result !== null };

  // idle: no frame and no running animation 1 s after settle (the page's own rAF calls, the render
  // ring, and the animations as the e2e fixture counts them)
  await page.mouse.move(0, 0);
  await settle();
  await sleep(1200);
  const idle0 = await page.evaluate(() => ({
    calls: window.__rafCalls,
    ring: window.__kestrelCloudViewer.frameTimes(),
  }));
  await sleep(1000);
  const idle1 = await page.evaluate(() => ({
    calls: window.__rafCalls,
    ring: window.__kestrelCloudViewer.frameTimes(),
  }));
  const idleRenders = ringTail(idle0.ring, idle1.ring, idle1.calls - idle0.calls);
  result.idle = {
    rafCalls: idle1.calls - idle0.calls,
    renders: idleRenders.n,
    rendersExact: idleRenders.exact,
    animations: await runningAnimations(),
  };

  // hover pick: rate and cost, three 5 s windows of mouse movement without a button; the medians are
  // the result (m4). The viewer hover-picks only while a picking tool is armed (engine.ts
  // pointermove: events.isArmed()), so the Point tool is armed; the path keeps to canvas points clear
  // of pins and panels.
  await page.keyboard.press("p");
  const c = await canvasCentre();
  let hoverPath = [];
  for (const r of [0.2, 0.12, 0.06]) {
    hoverPath = await page.evaluate(
      ([cx, cy, rx, ry]) => {
        const canvas = document.querySelector('[data-testid="cloud-canvas"]');
        const found = [];
        for (let k = 0; k < 90; k += 1) {
          const x = cx + Math.sin(k / 15) * rx;
          const y = cy + Math.cos(k / 15) * ry;
          if (document.elementFromPoint(x, y) === canvas) found.push([x, y]);
        }
        return found;
      },
      [c.x, c.y, c.w * r, c.h * r],
    );
    if (hoverPath.length >= 30) break;
  }
  result.hoverPathPoints = hoverPath.length;
  const hoverRuns = [];
  if (hoverPath.length === 0) problem("hover: no canvas point clear of pins and panels");
  else
    for (let run = 0; run < 3; run += 1) {
      const h = await profiled(cdp, async () => {
        const t0 = Date.now();
        for (let i = 0; Date.now() - t0 < 5000; i += 1) {
          const [x, y] = hoverPath[i % hoverPath.length];
          await page.mouse.move(x, y);
          await sleep(16);
        }
        return (Date.now() - t0) / 1000;
      });
      const ms = sum(profileTotals(h.profile, FN.hover));
      const n = sum(coverageCounts(h.coverage, FN.hover));
      hoverRuns.push({
        seconds: h.value,
        calls: n,
        totalMs: +ms.toFixed(3),
        hz: +(n / h.value).toFixed(2),
        msPerCall: n ? +(ms / n).toFixed(3) : null,
      });
      if (n === 0 || ms === 0) problem(`hover run ${run + 1}: ${FN.hover} total ${ms} ms over ${n} calls`);
    }
  await page.keyboard.press("Escape"); // back to Orbit
  const median = (xs) => {
    const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  result.hoverRuns = hoverRuns;
  result.hoverPickHz = median(hoverRuns.map((r) => r.hz));
  result.hoverPickMsPerCall = median(hoverRuns.map((r) => r.msPerCall));
  result.fnNames = { ...FN, occlusionEngine: OCC_ENGINE };
  result.timingNote =
    "pin pass, occlusion and hover pick: CPU-profile estimates, 100 us sampling, with precise-coverage call counting on (ruling G5)";

  const m = memory.stop();
  result.webviewPeakGB = +(m.peakBytes / 1e9).toFixed(2);
  result.webviewSamples = m.samples;
  result.webviewProcesses = m.processes;
  await shot(page, path.join(shots, `perf-${effects}.png`));
}

if (mode === "pins") {
  if (!env.KESTREL_RIM)
    fail("KESTREL_RIM=x,y is needed (the stack's rim, docs/evidence/2026-09-24-point-clouds/rim.txt)");
  const [rx, ry] = env.KESTREL_RIM.split(",").map(Number);
  await arrive(`?at=${rx.toFixed(3)},${ry.toFixed(3)}`);
  const made = [];
  for (const [dx, dy] of [
    [0, 0],
    [60, 10],
    [-60, 10],
    [20, 60],
    [-20, -60],
  ]) {
    // the Findings topic's button, not the M key: a key goes to a focused field instead (seen in clip mode)
    await w.openTopic("Findings");
    const pinTool = w.tool("Pin a finding");
    if ((await pinTool.getAttribute("aria-pressed")) !== "true") await pinTool.click();
    const c = await canvasCentre();
    const at = await clearPoint(c.x + dx, c.y + dy, 60);
    if (!at) fail(`no clear canvas point near (${dx}, ${dy})`);
    const created = page.waitForResponse(
      (r) => /\/findings$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    const viewPut = page.waitForResponse(
      (r) => /\/findings\/[^/]+\/view3d$/.test(new URL(r.url()).pathname) && r.request().method() === "PUT",
      { timeout: 30_000 },
    );
    await page.mouse.click(at.x, at.y);
    await w.callout.waitFor({ timeout: 10_000 });
    // PinCallout.tsx: the Type control is a button "Type: <label>"; the popover lists the types
    if (!/Crack/.test((await w.typeCombo.getAttribute("aria-label")) ?? "")) {
      await w.typeCombo.click();
      await page.getByRole("listbox").getByText("Crack", { exact: true }).click();
    }
    const t0 = Date.now();
    await page.keyboard.press("Enter"); // focus is on the note: a plain Enter creates
    const f = await (await created).json();
    const v = await viewPut;
    made.push({ id: f.id, anchor: f.anchor, captureMs: Date.now() - t0, viewStatus: v.status() });
    await page.keyboard.press("Escape");
    // Driver defect (Task 9, task-11-report.md problem 1): one Escape only disarms "Pin a finding"
    // back to Orbit; the just-created finding stays selected, so its callout (now PinCalloutView)
    // stays open and can cover the next offset's click point. A second Escape would deselect once
    // idle in Orbit, but closing it explicitly is immediate and does not depend on that state order.
    if (await w.callout.isVisible()) {
      await w.calloutClose.click();
      await sleep(300);
    }
  }
  result.pins = made;
  result.byView = {};
  for (const v of ["Top", "Front", "Side", "Iso"]) {
    await w.view(v).click();
    await settle();
    await sleep(800); // the occlusion pass after settle
    result.byView[v] = (await pins()).filter((p) => made.some((m) => m.id === p.id));
    await shot(page, path.join(shots, `pins-${v.toLowerCase()}.png`));
  }
  // Move pin: the view is captured again and is no longer stale (criterion 10)
  const first = made[0].id;
  await arrive(`?finding=${first}`);
  const movedPut = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith(`/findings/${first}/view3d`) && r.request().method() === "PUT",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "Move pin" }).click();
  const c = await canvasCentre();
  const to = await clearPoint(c.x + 25, c.y + 25, 60);
  if (!to) fail("no clear canvas point for Move pin");
  await page.mouse.click(to.x, to.y);
  await movedPut;
  await sleep(500);
  const views = (await api(`/pointclouds/${env.KESTREL_CLOUD_ID}/views`)).body.items;
  result.moved = { id: first, stale: views.find((x) => x.subject_id === first)?.stale ?? null };
  // Driver defect (Task 9, task-11-report.md problem 2): `made[0].anchor` (== `result.pins[0].anchor`,
  // same array) was left at its pre-move value, so pins-check (reading this file back after a
  // restart) compared the *current* anchor against the *original* one and reported a false "anchor
  // moved across the restart". Record the anchor Move pin actually left it at — pins-check then still
  // requires the restart to keep that one unchanged (d ~= 0).
  const movedFinding = (await api(`/findings/${first}`)).body;
  made.find((m) => m.id === first).anchor = movedFinding.anchor;
}

if (mode === "pins-check") {
  const file = env.KESTREL_PINS ?? path.join(shots, "pins-full.json");
  const before = JSON.parse(fs.readFileSync(file, "utf8")).pins;
  const RESTART_TOL_M = 1e-6;
  result.restartTolM = RESTART_TOL_M;
  result.rows = [];
  for (const p of before) {
    const f = (await api(`/findings/${p.id}`)).body;
    await arrive(`?finding=${p.id}`);
    const pick = await page.evaluate(() => window.__kestrelCloudViewer.pickCenter());
    const a = f.anchor;
    // the stored anchor must survive the restart unchanged (finding 4): float64 JSON both ways, so
    // RESTART_TOL_M is round-off only; the re-pick must land within the uncertainty
    const pre = p.anchor ?? null;
    const dRestart = pre ? hypot3([pre.x, pre.y, pre.z], [a.x, a.y, a.z]) : null;
    const kept = dRestart !== null && dRestart <= RESTART_TOL_M;
    const d = pick ? hypot3([pick.x, pick.y, pick.z], [a.x, a.y, a.z]) : null;
    const tol = Math.max(a.uncertainty_m ?? 0, pick?.uncertainty_m ?? 0);
    result.rows.push({
      id: p.id,
      pre,
      anchor: a,
      dRestart,
      kept,
      pick,
      d,
      tol,
      pass: kept && d !== null && d <= tol,
    });
    if (!kept) problem(`pins-check ${p.id}: anchor moved ${dRestart} m across the restart`);
  }
  await shot(page, path.join(shots, "pins-after-restart.png"));
}

if (mode === "clip") {
  if (!env.KESTREL_RIM) fail("KESTREL_RIM=x,y is needed");
  const [rx, ry] = env.KESTREL_RIM.split(",").map(Number);
  await arrive(`?at=${rx.toFixed(3)},${ry.toFixed(3)}`);
  // the clipping box, show-inside: C places the default box (the cloud's centre, clip.ts
  // defaultClipBox); a click recentres it on the view's target
  await page.keyboard.press("c");
  const cc = await canvasCentre();
  const centre = await clearPoint(cc.x, cc.y);
  if (!centre) fail("no clear canvas point to recentre the clip box");
  await page.mouse.click(centre.x, centre.y);
  await settle();
  // the Point tool from the Measure topic (a key would go to a focused hint-bar field), re-armed before
  // every click: a missed save must not leave the next clicks in Orbit
  await w.openTopic("Measure");
  const point = w.tool("Point");
  const armPoint = async () => {
    if ((await point.getAttribute("aria-pressed")) !== "true") await point.click();
  };
  const c = await canvasCentre();
  // the 5 x 4 click grid spans ±KESTREL_CLIP_SPREAD of the canvas around its centre (default 0.4)
  const spread = Number(env.KESTREL_CLIP_SPREAD ?? 0.4);
  result.spread = spread;
  const saved = [];
  const misses = [];
  let clicks = 0;
  for (let i = 0; i < 5; i += 1)
    for (let j = 0; j < 4; j += 1) {
      const at = await clearPoint(
        c.x - c.w * spread + (c.w * 2 * spread * i) / 4,
        c.y - c.h * spread + (c.h * 2 * spread * j) / 3,
        40,
      );
      if (!at) continue;
      await armPoint();
      const post = page
        .waitForResponse(
          (r) => /\/measurements$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
          {
            timeout: 2500,
          },
        )
        .catch(() => null);
      await page.mouse.click(at.x, at.y);
      clicks += 1;
      await page.keyboard.press("Enter");
      const r = await post;
      if (r && r.ok()) {
        const body = await r.json();
        saved.push(body.measurement ?? body); // a point saves bare; a kind with a job as {measurement, job}
      } else misses.push({ at, status: r ? r.status() : null });
    }
  let views = [];
  for (const until = Date.now() + 90_000; Date.now() < until; await sleep(500)) {
    views = (await api(`/pointclouds/${env.KESTREL_CLOUD_ID}/views`)).body.items;
    if (saved.every((m) => views.some((v) => v.subject_id === m.id))) break;
  }
  result.clicks = clicks;
  result.misses = misses;
  if (clicks < 20) problem(`clip: ${clicks} of 20 clicks made (no canvas point clear of pins and panels)`);
  result.rows = saved.map((m) => {
    const box = views.find((v) => v.subject_id === m.id)?.render.clip_box ?? null;
    const p = m.points[0];
    return {
      id: m.id,
      point: [p.x, p.y, p.z],
      box,
      inside: box ? insideClipBox([p.x, p.y, p.z], box, p.uncertainty_m) : null,
    };
  });
  result.saved = saved.length;
  if (saved.length === 0) problem("clip: no click saved a point (nothing to test against the box)");
  result.outside = result.rows.filter((r) => r.inside === false).length;
  result.noBox = result.rows.filter((r) => r.box === null).length;
  await shot(page, path.join(shots, "clip.png"));
}

if (mode === "photolink") {
  const spots = JSON.parse(env.KESTREL_SPOTS ?? "[]");
  if (spots.length === 0) fail("KESTREL_SPOTS=[[x,y],...] (10 spots on the structure) is needed");
  result.rows = [];
  for (const [k, [x, y]] of spots.entries()) {
    await arrive(`?at=${x.toFixed(3)},${y.toFixed(3)}`);
    await page.keyboard.press("i");
    const c = await canvasCentre();
    const at = await clearPoint(c.x, c.y);
    if (!at) {
      result.rows.push({ spot: [x, y], hits: null, url: null, why: "no clear canvas point" });
      continue;
    }
    await page.mouse.click(at.x, at.y);
    await w.photoList.waitFor({ timeout: 10_000 }).catch(() => {});
    const buttons = w.photoList.getByRole("button");
    // PhotoLinkTool.tsx: each row's button is "Open photo <k>, <method>, <distance>"
    const hits = await buttons
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
      .catch(() => []);
    await shot(page, path.join(shots, `photolink-${k + 1}.png`));
    let url = null;
    if (hits.length) {
      await buttons.first().click();
      await page.waitForURL(/\/images\//, { timeout: 10_000 }).catch(() => {});
      url = page.url();
      await sleep(3000);
      await shot(page, path.join(shots, `photolink-${k + 1}-image.png`));
      await page.goBack();
    }
    result.rows.push({ spot: [x, y], hits, url });
  }
}

if (mode === "image2cloud") {
  const cases = JSON.parse(env.KESTREL_IMAGE_PX ?? "[]");
  if (cases.length === 0) fail('KESTREL_IMAGE_PX=[{"image_id":…,"u":…,"v":…,"expected":[x,y,z]}] is needed');
  result.rows = [];
  for (const [k, t] of cases.entries()) {
    await arrive(`?from_image=${t.image_id}&px=${t.u},${t.v}`);
    const pick = await page.evaluate(() => window.__kestrelCloudViewer.pickCenter());
    const d = pick ? hypot3([pick.x, pick.y, pick.z], t.expected) : null;
    await shot(page, path.join(shots, `image2cloud-${k + 1}.png`));
    result.rows.push({ ...t, pick, d, pass: d !== null && d <= 1.0 });
  }
}

if (mode === "formulas") {
  // KESTREL_SHAPES: the `pointcloud_acceptance.py shapes --out` line ({area, rings, twopoint}: points,
  // params and the server's results). The client side is measure.ts's measureResults, the function
  // the workspace computes a live result with (C-X1/C-B1/C-B3), loaded through Vite.
  const shapes = JSON.parse(fs.readFileSync(env.KESTREL_SHAPES, "utf8"));
  const client = await page.evaluate(async (s) => {
    const m = await import("/src/clouds/measure.ts");
    const run = (c, kind) => m.measureResults(kind, c.points, c.params);
    return {
      area: run(s.area, "area"),
      rings: run(s.rings, "vertical"),
      twopoint: run(s.twopoint, "vertical"),
    };
  }, shapes);
  const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));
  result.rows = [
    ["area", "area_surface_m2"],
    ["area", "area_plan_m2"],
    ["rings", "lean_angle_deg"],
    ["rings", "lean_azimuth_deg"],
    ["twopoint", "lean_angle_deg"],
    ["twopoint", "lean_azimuth_deg"],
  ].map(([k, key]) => {
    const server = shapes[k].server[key];
    const cl = client[k][key];
    const ok = typeof server === "number" && typeof cl === "number";
    return { case: k, key, server, client: cl, equal: ok && rel(cl, server) <= 1e-9 };
  });
}

if (mode === "hold") {
  // Operator time (criteria 4, 5, 8): the app stays open until the operator closes this tab; then the
  // cloud's measurements (what the operator measured by hand) are written out.
  await go();
  console.log("hold: the workspace is open in Edge; measure by hand, then close the tab to finish");
  await page.waitForEvent("close", { timeout: 0 });
  result.measurements = (await api(`/pointclouds/${env.KESTREL_CLOUD_ID}/measurements`)).body.items.map(
    (m) => ({
      id: m.id,
      kind: m.kind,
      name: m.name,
      params: m.params,
      points: m.points,
      results: Object.fromEntries(Object.entries(m.results).filter(([, v]) => v !== null)),
    }),
  );
}

result.problems = problems;
fs.writeFileSync(out, JSON.stringify(result, null, 2));
if (problems.length) {
  console.log(`measure ${mode} FAIL ${problems.length} unmeasured or short, see ${out}`);
  process.exit(1);
}
console.log(`measure ${mode} ok ${out}`);
process.exit(0);
