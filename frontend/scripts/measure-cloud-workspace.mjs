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
  occlusion: (env.KESTREL_FN_OCCLUSION ?? "occlusion").split(","),
  hover: (env.KESTREL_FN_HOVER ?? "pickAtClient").split(","),
};
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
await page.waitForFunction(() => document.readyState === "complete", null, { timeout: 60_000 });
await page.evaluate(
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
const stats = () => page.evaluate(() => window.__kestrelCloudViewer?.stats() ?? null);
const pins = () => page.evaluate(() => window.__kestrelCloudViewer?.pins?.() ?? []);
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
      body: JSON.stringify({ type_id: env.KESTREL_CRACK_TYPE, severity: (i % 4) + 1, anchor }),
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
    palette: w.palette,
    inspectorTabs: w.inspectorTabs,
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
  const have = (await api(`/findings?data_id=${env.KESTREL_CLOUD_ID}&limit=500`)).body?.items?.length ?? 0;
  if (have < 200) await createPins(200 - have);
  const memory = memorySampler();
  // a fresh open (the viewer unmounts on the Overview and mounts again): first points and settled
  await page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate"));
  }, `/p/${env.KESTREL_PROJECT_ID}`);
  await sleep(1000);
  await go();
  let s = await settle();
  for (let i = 0; i < 100 && s && s.settledMs == null; i += 1) {
    await sleep(100);
    s = await stats();
  }
  result.firstPointsMs = s?.firstPointsMs ?? null;
  result.settledMs = s?.settledMs ?? null;
  result.visiblePoints = s?.numVisiblePoints ?? null;
  for (let i = 0; i < 100 && (await pins()).length < 200; i += 1) await sleep(200);
  const rows = await pins();
  result.pins = rows.length;
  result.pinsVisible = rows.filter((p) => p.state === "visible").length;
  if (effects === "full" && (await w.edl.getAttribute("aria-checked")) !== "true") await w.edl.click();
  result.edl = (await w.edl.getAttribute("aria-checked")) === "true";
  await w.findingsTab.click(); // every panel shown: inspector on Findings, cameras as they default
  await settle();

  // orbit, no profiler attached: the frame times (spec §13 orbit p50/p95)
  const o = await measuredOrbit(ORBIT_MS, env.KESTREL_ORBIT_INPUT ?? "mouse");
  result.orbitInput = o.input;
  result.orbitStart = o.start;
  result.orbitCameraMoved = +o.cameraMoved.toFixed(3);
  result.orbitRaf = frameStats(o.raf);
  result.orbitRender = frameStats(o.render);
  result.orbitRenderRingExact = o.ringExact;
  if (o.cameraMoved <= 1e-3) fail(`the orbit did not move the camera (${o.input})`);
  if (o.raf.length < 60 || o.render.length === 0)
    fail(`orbit samples raf=${o.raf.length} render=${o.render.length}`);
  await settle();

  // orbit again under the CPU profiler (G5: 100 us sampling, an estimate): the pin pass per frame
  const cdp = await context.newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
  const po = await measuredOrbit(PROFILED_ORBIT_MS, o.input);
  const orbitProfile = (await cdp.send("Profiler.stop")).profile;
  const frames = po.render.length || po.raf.length;
  result.pinPassMsPerFrame = +(sum(profileTotals(orbitProfile, FN.pins)) / Math.max(1, frames)).toFixed(4);
  result.pinPassFrames = frames;

  // settle: the occlusion pass runs once
  await cdp.send("Profiler.start");
  await settle();
  await sleep(1500);
  const occTotals = profileTotals((await cdp.send("Profiler.stop")).profile, FN.occlusion);
  result.occlusionMsPerSettle = +sum(occTotals).toFixed(3);

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
  result.idle = {
    rafCalls: idle1.calls - idle0.calls,
    renders: ringTail(idle0.ring, idle1.ring, 0).n,
    animations: await runningAnimations(),
  };

  // hover pick: rate and cost over 5 s of mouse movement without a button. The viewer hover-picks
  // only while a picking tool is armed (engine.ts pointermove: events.isArmed()), so the Point tool
  // is armed for the window; the path keeps to canvas points clear of pins and panels.
  await page.keyboard.press("p");
  const c = await canvasCentre();
  let path2 = [];
  for (const r of [0.2, 0.12, 0.06]) {
    path2 = await page.evaluate(
      ([cx, cy, rx, ry]) => {
        const canvas = document.querySelector('[data-testid="cloud-canvas"]');
        const out = [];
        for (let k = 0; k < 90; k += 1) {
          const x = cx + Math.sin(k / 15) * rx;
          const y = cy + Math.cos(k / 15) * ry;
          if (document.elementFromPoint(x, y) === canvas) out.push([x, y]);
        }
        return out;
      },
      [c.x, c.y, c.w * r, c.h * r],
    );
    if (path2.length >= 30) break;
  }
  result.hoverPathPoints = path2.length;
  await cdp.send("Profiler.startPreciseCoverage", { callCount: true, detailed: false });
  await cdp.send("Profiler.takePreciseCoverage"); // resets the counters: count only the hover window
  await cdp.send("Profiler.start");
  const t0 = Date.now();
  for (let i = 0; path2.length && Date.now() - t0 < 5000; i += 1) {
    const [x, y] = path2[i % path2.length];
    await page.mouse.move(x, y);
    await sleep(16);
  }
  const hoverS = (Date.now() - t0) / 1000;
  const hoverProfile = (await cdp.send("Profiler.stop")).profile;
  const calls = coverageCounts(await cdp.send("Profiler.takePreciseCoverage"), FN.hover);
  await cdp.send("Profiler.stopPreciseCoverage");
  const hoverMs = sum(profileTotals(hoverProfile, FN.hover));
  const hoverCalls = sum(calls);
  result.hoverPickHz = +(hoverCalls / hoverS).toFixed(2);
  result.hoverPickMsPerCall = hoverCalls ? +(hoverMs / hoverCalls).toFixed(3) : null;
  await page.keyboard.press("Escape"); // back to Orbit
  result.fnNames = FN;
  result.timingNote =
    "pin pass, occlusion and hover pick: CPU-profile estimates, 100 us sampling (ruling G5)";

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
    await page.keyboard.press("m");
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
}

if (mode === "pins-check") {
  const file = env.KESTREL_PINS ?? path.join(shots, "pins-full.json");
  const before = JSON.parse(fs.readFileSync(file, "utf8")).pins;
  result.rows = [];
  for (const p of before) {
    const f = (await api(`/findings/${p.id}`)).body;
    await arrive(`?finding=${p.id}`);
    const pick = await page.evaluate(() => window.__kestrelCloudViewer.pickCenter());
    const a = f.anchor;
    const d = pick ? hypot3([pick.x, pick.y, pick.z], [a.x, a.y, a.z]) : null;
    const tol = Math.max(a.uncertainty_m ?? 0, pick?.uncertainty_m ?? 0);
    result.rows.push({ id: p.id, anchor: a, pick, d, tol, pass: d !== null && d <= tol });
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
  await page.keyboard.press("p");
  const c = await canvasCentre();
  const saved = [];
  for (let i = 0; i < 5; i += 1)
    for (let j = 0; j < 4; j += 1) {
      const at = await clearPoint(
        c.x - c.w * 0.4 + (c.w * 0.8 * i) / 4,
        c.y - c.h * 0.4 + (c.h * 0.8 * j) / 3,
        40,
      );
      if (!at) continue;
      const post = page
        .waitForResponse(
          (r) => /\/measurements$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
          {
            timeout: 2500,
          },
        )
        .catch(() => null);
      await page.mouse.click(at.x, at.y);
      await page.keyboard.press("Enter");
      const r = await post;
      if (r && r.status() === 201) {
        const body = await r.json();
        saved.push(body.measurement ?? body); // a point saves bare; a kind with a job as {measurement, job}
      } else await page.keyboard.press("Escape");
    }
  let views = [];
  for (const until = Date.now() + 90_000; Date.now() < until; await sleep(500)) {
    views = (await api(`/pointclouds/${env.KESTREL_CLOUD_ID}/views`)).body.items;
    if (saved.every((m) => views.some((v) => v.subject_id === m.id))) break;
  }
  result.clicks = 20;
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

fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`measure ${mode} ok ${out}`);
process.exit(0);
