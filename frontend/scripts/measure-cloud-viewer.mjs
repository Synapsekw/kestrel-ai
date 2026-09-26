// Acceptance measurements on the packaged viewer (spec §17.6, 17.7, 17.9, 17.10). Run through
// check-packaged-webview.ps1 -Driver, which starts the backend and the app and sets KESTREL_*.
// KESTREL_MODE: perf (default) | picks | uncertainty. Results go to KESTREL_OUT as JSON.
import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const env = process.env;
const mode = env.KESTREL_MODE ?? "perf";
const out = env.KESTREL_OUT ?? path.join(env.KESTREL_WORK_DIR, `measure-${mode}.json`);
const shots = env.KESTREL_SHOTS ?? env.KESTREL_WORK_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (p, init = {}) =>
  fetch(`${env.KESTREL_BACKEND_URL}/api/v1/projects/${env.KESTREL_PROJECT_ID}${p}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.KESTREL_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  }).then((r) => r.json());

function webviewBytes() {
  // WebView2 processes of this run only: their command line carries the temp user-data folder.
  const dir = env.KESTREL_WEBVIEW_DIR.replace(/'/g, "''");
  const ps = `(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${dir}*' } | Measure-Object -Property WorkingSetSize -Sum).Sum`;
  return new Promise((resolve) =>
    execFile("powershell", ["-NoProfile", "-Command", ps], (_e, stdout) =>
      resolve(Number(String(stdout).trim()) || 0),
    ),
  );
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${env.KESTREL_CDP_PORT}`);
const context = browser.contexts()[0];
let page = context.pages()[0];
for (let i = 0; !page && i < 100; i += 1) {
  await sleep(100);
  page = context.pages()[0];
}
if (!page) {
  console.log("measure FAIL the packaged app has no page");
  process.exit(1);
}
await page.waitForFunction(() => document.readyState === "complete", null, { timeout: 30_000 });
await page.evaluate((b) => {
  localStorage.setItem("kestrel.diagnostics", "1");
  localStorage.setItem("kestrel.clouds.pointBudget", String(b));
}, Number(env.KESTREL_BUDGET));
const cloud = await api(`/pointclouds/${env.KESTREL_CLOUD_ID}`);
const go = (search = "") =>
  page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate"));
  }, `/p/${env.KESTREL_PROJECT_ID}/clouds/${env.KESTREL_CLOUD_ID}${search}`);
const stats = () => page.evaluate(() => window.__kestrelCloudViewer?.stats() ?? null);
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
const canvasCentre = async () => {
  const b = await page.getByTestId("cloud-canvas").boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
};
const result = {
  mode,
  budget: Number(env.KESTREL_BUDGET),
  cloud: { id: cloud.id, points: cloud.point_count },
};

if (mode === "perf") {
  let peak = 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      peak = Math.max(peak, await webviewBytes());
      await sleep(500);
    }
  })();
  await go();
  const s = await settle();
  result.firstPointsMs = s.firstPointsMs;
  result.settledMs = s.settledMs;
  result.points = s.numVisiblePoints;
  await page.screenshot({ path: path.join(shots, `viewer-${result.budget / 1e6}M-site.png`) });
  const c = await canvasCentre();
  await page.evaluate(() => {
    window.__frames = [];
    window.__framing = true;
    const f = (t) => {
      window.__frames.push(t);
      if (window.__framing) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  const t0 = Date.now();
  for (let i = 0; Date.now() - t0 < 10_000; i += 1) {
    await page.mouse.move(c.x + Math.sin(i / 20) * c.w * 0.3, c.y + Math.cos(i / 35) * c.h * 0.05);
    await sleep(16);
  }
  await page.mouse.up();
  const deltas = await page.evaluate(() => {
    window.__framing = false;
    const f = window.__frames;
    return f
      .slice(1)
      .map((t, i) => t - f[i])
      .sort((a, b) => a - b);
  });
  result.orbitFrames = deltas.length;
  result.orbitP50Ms = deltas[Math.floor(deltas.length * 0.5)];
  result.orbitP95Ms = deltas[Math.floor(deltas.length * 0.95)];
  await settle();
  const colours = await page.evaluate(() => window.__kestrelCloudViewer.sampleColours());
  result.colours = colours;
  result.whiteShareOfPoints = colours.white / Math.max(1, colours.total - colours.background);
  sampling = false;
  await sampler;
  result.webviewPeakGB = +(peak / 1e9).toFixed(2);
  await page.screenshot({ path: path.join(shots, `viewer-${result.budget / 1e6}M-after-orbit.png`) });
}

if (mode === "picks") {
  const b = cloud.bounds_native;
  const cx = (b[0] + b[3]) / 2;
  const cy = (b[1] + b[4]) / 2;
  const spots = env.KESTREL_SPOTS
    ? JSON.parse(env.KESTREL_SPOTS)
    : [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => [cx + i * 15, cy + j * 15])).concat([[cx + 5, cy - 7]]);
  result.picks = [];
  for (const [x, y] of spots.slice(0, 10)) {
    await go(`?at=${x.toFixed(3)},${y.toFixed(3)}`);
    await settle();
    await sleep(3000); // the jump's Z refine
    await settle();
    const p = await page.evaluate(() => window.__kestrelCloudViewer.pickCenter());
    if (!p) continue;
    const m = await api(`/pointclouds/${env.KESTREL_CLOUD_ID}/measurements`, {
      method: "POST",
      body: JSON.stringify({
        kind: "point",
        points: [{ x: p.x, y: p.y, z: p.z, uncertainty_m: p.uncertainty_m }],
      }),
    });
    result.picks.push({ at: [x, y], pick: p, measurement: m.id });
  }
  await page.screenshot({ path: path.join(shots, "viewer-picks.png") });
}

if (mode === "uncertainty") {
  const [rx, ry] = env.KESTREL_RIM.split(",").map(Number);
  await go(`?at=${rx.toFixed(3)},${ry.toFixed(3)}`);
  await settle();
  await sleep(3000);
  const c = await canvasCentre();
  await page.mouse.move(c.x, c.y);
  const b = cloud.bounds_native;
  const diagonal = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
  for (let i = 0; i < 60 && (await stats()).cameraDistance < 0.8 * diagonal; i += 1) {
    await page.mouse.wheel(0, 400);
    await sleep(50);
  }
  const far = await settle();
  const siteWide = await page.evaluate(() => window.__kestrelCloudViewer.pickCenter());
  await page.screenshot({ path: path.join(shots, "uncertainty-site.png") });
  for (let i = 0; i < 200 && (await stats()).cameraDistance > 30; i += 1) {
    await page.mouse.wheel(0, -200);
    await sleep(50);
  }
  const near = await settle();
  const close = await page.evaluate(() => window.__kestrelCloudViewer.pickCenter());
  await page.screenshot({ path: path.join(shots, "uncertainty-close.png") });
  result.siteWide = { cameraDistance: far.cameraDistance, pick: siteWide };
  result.close = { cameraDistance: near.cameraDistance, pick: close };
  result.ratio = siteWide && close ? siteWide.uncertainty_m / close.uncertainty_m : null;
}

fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`measure ${mode} ok ${out}`);
process.exit(0);
