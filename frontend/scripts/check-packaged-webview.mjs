// The packaged-webview check's driver (spec §13 step 6-7). Run by check-packaged-webview.ps1, which
// sets KESTREL_* in the environment. Imports chromium from @playwright/test (a direct dependency).
import { chromium } from "@playwright/test";

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
console.log(`webview ok points=${stats.numVisiblePoints} red=${red.toFixed(3)} green=${green.toFixed(3)}`);
process.exit(0);
