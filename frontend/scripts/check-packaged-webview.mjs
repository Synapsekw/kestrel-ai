// The packaged-webview check's driver (spec §13 step 6-7). Run by check-packaged-webview.ps1, which
// sets KESTREL_* in the environment. Imports chromium from @playwright/test (a direct dependency).
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { colourSpread, pinGrid, pngSize } from "./cloud-perf-lib.mjs";
import { pageColours, ui } from "./cloud-ui.mjs";

const env = process.env;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (reason) => {
  console.log(`webview FAIL ${reason}`);
  process.exit(1);
};
const CSP = /Content Security Policy|Refused to/;

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${env.KESTREL_CDP_PORT}`);
const context = browser.contexts()[0];
let page = context.pages()[0];
for (let i = 0; !page && i < 100; i += 1) {
  await sleep(100);
  page = context.pages()[0];
}
if (!page) fail("the packaged app has no page");

const csp = [];
const octree = [];
page.on("console", (m) => CSP.test(m.text()) && csp.push(m.text()));
const cdp = await context.newCDPSession(page);
await cdp.send("Log.enable");
await cdp.send("Runtime.enable");
await cdp.send("Network.enable");
cdp.on("Log.entryAdded", (e) => CSP.test(e.entry.text) && csp.push(e.entry.text));
cdp.on("Network.responseReceived", (e) => {
  if (e.response.url.includes("/octree/") && e.response.status >= 400)
    octree.push(`${e.response.status} ${e.response.url}`);
});
cdp.on("Network.loadingFailed", (e) => {
  if (e.canceled) return;
  octree.push(
    `loadingFailed ${e.errorText}${e.blockedReason ? ` blocked:${e.blockedReason}` : ""}${e.corsErrorStatus ? ` cors:${e.corsErrorStatus.corsError}` : ""}`,
  );
});

await page.waitForFunction(() => document.readyState === "complete", null, { timeout: 30_000 });
await page.evaluate(
  (budget) => {
    localStorage.setItem("kestrel.diagnostics", "1");
    localStorage.setItem("kestrel.clouds.pointBudget", String(budget));
  },
  Number(env.KESTREL_BUDGET ?? 3000000),
);
await page.evaluate((path) => {
  history.pushState({}, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
}, `/p/${env.KESTREL_PROJECT_ID}/clouds/${env.KESTREL_CLOUD_ID}`);

let stats = null;
const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  stats = await page.evaluate(() => window.__kestrelCloudViewer?.stats() ?? null);
  if (stats && stats.numVisiblePoints > 0 && stats.nodesLoading === 0) break;
  await sleep(250);
}
if (csp.length) fail(`CSP: ${csp[0]}`);
if (!stats) fail("the viewer never mounted (no diagnostics hook)");
if (!(stats.numVisiblePoints > 0 && stats.nodesLoading === 0))
  fail(`no settled points after 30 s: ${JSON.stringify(stats)}`);
if (octree.length) fail(`octree request failed: ${octree[0]}`);

const colours = await page.evaluate(() => window.__kestrelCloudViewer.sampleColours());
const red = colours.red / colours.total;
const green = colours.green / colours.total;
if (red < 0.01 || green < 0.01)
  fail(
    `colours: red=${red.toFixed(4)} green=${green.toFixed(4)} white=${colours.white} (the white-colour trap paints every point white)`,
  );

const cloud = await (
  await fetch(
    `${env.KESTREL_BACKEND_URL}/api/v1/projects/${env.KESTREL_PROJECT_ID}/pointclouds/${env.KESTREL_CLOUD_ID}`,
    {
      headers: { Authorization: `Bearer ${env.KESTREL_TOKEN}` },
    },
  )
).json();
const pick = await page.evaluate(() => window.__kestrelCloudViewer.pickCenter());
const b = cloud.bounds_native;
if (
  !pick ||
  pick.x < b[0] ||
  pick.x > b[3] ||
  pick.y < b[1] ||
  pick.y > b[4] ||
  pick.z < b[2] - 1 ||
  pick.z > b[5] + 1
) {
  fail(`pickCenter ${JSON.stringify(pick)} is not inside the cloud ${JSON.stringify(b)}`);
}
// C-G (spec section 15 "Packaged"): EDL on, 50 pins, and one report-view capture.
const base = `${env.KESTREL_BACKEND_URL}/api/v1/projects/${env.KESTREL_PROJECT_ID}`;
const headers = { Authorization: `Bearer ${env.KESTREL_TOKEN}`, "Content-Type": "application/json" };
const w = ui(page);
await w.openTopic("Layers");
if ((await w.edl.getAttribute("aria-checked")) !== "true") await w.edl.click();
for (const [i, [x, y]] of pinGrid(b, 50).entries()) {
  const hit = await page.evaluate(([px, py]) => window.__kestrelCloudViewer.pickDown(px, py, 2), [x, y]);
  const anchor = {
    kind: "cloud",
    cloud_id: env.KESTREL_CLOUD_ID,
    x,
    y,
    z: hit ? hit.z : (b[2] + b[5]) / 2,
    uncertainty_m: hit ? hit.uncertainty_m : 0.1,
  };
  const r = await fetch(`${base}/findings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ type_id: env.KESTREL_CRACK_TYPE, severity: (i % 4) + 1, anchor }),
  });
  if (r.status !== 201) fail(`createFinding ${r.status} ${await r.text()}`);
}
let pins = [];
for (const until = Date.now() + 30_000; Date.now() < until; await sleep(250)) {
  pins = await page.evaluate(() => window.__kestrelCloudViewer.pins?.() ?? []);
  if (pins.length === 50) break;
}
if (pins.length !== 50) fail(`pins: ${pins.length} of 50 drawn after findings.changed`);
const edlColours = await page.evaluate(() => window.__kestrelCloudViewer.sampleColours());
if (edlColours.red / edlColours.total < 0.01 || edlColours.green / edlColours.total < 0.01)
  fail(`colours with EDL and pins: ${JSON.stringify(edlColours)}`);

await w.captureMissing();
let views = [];
for (const until = Date.now() + 30_000; Date.now() < until; await sleep(250)) {
  views = (await (await fetch(`${base}/pointclouds/${env.KESTREL_CLOUD_ID}/views`, { headers })).json())
    .items;
  if (views.length >= 1) break;
}
await w.hintCancel.click().catch(() => {}); // stop after the first; the check needs one capture
if (views.length < 1) fail("no report view was captured within 30 s of Capture missing views");
const v = views[0];
const img = new Uint8Array(
  await (await fetch(`${base}/findings/${v.subject_id}/view3d`, { headers })).arrayBuffer(),
);
const size = pngSize(img);
if (!size || size.width !== 1600 || size.height !== 1000) fail(`capture size ${JSON.stringify(size)}`);
if (createHash("sha256").update(img).digest("hex") !== v.sha256)
  fail("capture bytes do not match listCloudViews' sha256");
// C-V1 Ruling 3 / C-V2 Ruling 5: potree-core 2.0.15's EDLPass cannot render into a render target
// (EDL_RENDERS_TO_TARGET = false), so every capture records render.edl=false regardless of the
// on-screen EDL switch (docs/evidence/clouds/README.md "Deviations"). A warning, not a failure.
if (v.render.edl !== true)
  console.log(
    `webview WARN capture render.edl=${v.render.edl} (EDL cannot render to a target: known engine limit)`,
  );
const spread = colourSpread(await pageColours(page, img));
if (spread.distinct < 2 || spread.nonBackground <= 0.01)
  fail(`capture looks blank: ${JSON.stringify(spread)}`);

console.log(
  `webview ok points=${stats.numVisiblePoints} red=${red.toFixed(3)} green=${green.toFixed(3)} edl=on pins=50 capture=${size.width}x${size.height} colours=${spread.distinct}`,
);
process.exit(0);
