// Integration checkpoint 4 (spec 13.4): the installed app. Launches the installed exe, times the
// cold start (process start -> Projects heading, and -> first healthy backend_info), creates a
// project from the UI, closes the window and checks the sidecar exits, then repeats the launch
// once for a warm-start number. Evidence is written to <evidenceDir>/checkpoint4.json.
// Usage: node scripts/checkpoint4.mjs <installedExe> <projectFolder> <evidenceDir>
import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [exe, projectFolder, evidenceDir] = process.argv.slice(2);
if (!exe || !projectFolder || !evidenceDir) throw new Error("usage: checkpoint4.mjs <installedExe> <projectFolder> <evidenceDir>");
mkdirSync(evidenceDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = { exe, launches: [], steps: [] };
const step = (name, ok, detail = "") => {
  result.steps.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
  if (!ok) throw new Error(`step failed: ${name}`);
};
const ps = (script) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim();
const sidecarPids = () => ps("(Get-Process kestrel-backend -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ','");

async function attach() {
  for (let i = 0; i < 120; i++) {
    try {
      const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 2000 });
      const page = browser.contexts().flatMap((c) => c.pages()).find((p) => /tauri\.localhost|127\.0\.0\.1:1420/.test(p.url()));
      if (page) return { browser, page };
      await browser.close();
    } catch {}
    await sleep(250);
  }
  throw new Error("could not attach to the app webview on port 9222");
}

async function launch(label) {
  if (sidecarPids()) throw new Error(`a sidecar is already running before the ${label} launch: ${sidecarPids()}`);
  const t0 = Date.now();
  const child = spawn(exe, [], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222" },
  });
  child.unref();
  const { browser, page } = await attach();
  await page.getByRole("heading", { name: "Projects", exact: true }).waitFor({ timeout: 60_000 });
  const tProjects = Date.now() - t0;
  let info = null;
  for (let i = 0; i < 240; i++) {
    info = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("backend_info")).catch(() => null);
    if (info?.base_url && info?.token) {
      const r = await fetch(`${info.base_url}/api/v1/health`, { headers: { Authorization: `Bearer ${info.token}` } }).catch(() => null);
      if (r?.ok) break;
    }
    await sleep(250);
  }
  const tHealthy = Date.now() - t0;
  // The gpu block is probed in a background thread after the first health request; wait for it.
  let health = null;
  for (let i = 0; i < 120; i++) {
    health = await (await fetch(`${info.base_url}/api/v1/health`, { headers: { Authorization: `Bearer ${info.token}` } })).json();
    if (health.gpu) break;
    await sleep(500);
  }
  const tGpu = Date.now() - t0;
  console.log(`${label}: gpu probe answered after ${tGpu} ms: ${JSON.stringify(health.gpu)}`);
  result.launches.push({ label, pid: child.pid, ms_to_projects: tProjects, ms_to_healthy_backend: tHealthy, ms_to_gpu_probe: tGpu, sidecar_pids: sidecarPids(), log_path: info.log_path ?? null, health });
  console.log(`${label}: Projects heading after ${tProjects} ms, healthy backend after ${tHealthy} ms (sidecar pid ${sidecarPids()})`);
  return { browser, page, info, health };
}

async function closeAndCheck(browser, label) {
  await browser.close();
  ps("Get-Process machinery-app -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }");
  let remaining = sidecarPids();
  for (let i = 0; i < 40 && remaining; i++) {
    await sleep(250);
    remaining = sidecarPids();
  }
  const appLeft = ps("(Get-Process machinery-app -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ','");
  step(`${label}: closing the window stops the sidecar and the app`, !remaining && !appLeft, `sidecar left "${remaining}" app left "${appLeft}"`);
}

// Cold start (first launch after install; the OS file cache is as cold as a fresh session gets).
const cold = await launch("cold");
step("cold start under 15 s to the Projects screen", cold ? result.launches[0].ms_to_projects < 15_000 : false, `${result.launches[0].ms_to_projects} ms`);
step("sidecar healthy with gpu visible", cold.health.status === "ok" && cold.health.gpu?.available === true, JSON.stringify(cold.health.gpu));
await cold.page.screenshot({ path: join(evidenceDir, "checkpoint4-01-projects.png") });

// Project creation from the installed app.
await cold.page.fill("#project-name", "Checkpoint 4");
await cold.page.fill("#project-folder", projectFolder);
await cold.page.getByRole("button", { name: "Create project" }).click();
await cold.page.waitForURL(/\/p\/[0-9a-f-]+\/data/, { timeout: 30_000 });
const pid = cold.page.url().split("/p/")[1].split("/")[0];
const project = await (await fetch(`${cold.info.base_url}/api/v1/projects/${pid}`, { headers: { Authorization: `Bearer ${cold.info.token}` } })).json();
step("project created from the installed app", project.classes?.length === 8, `${pid} ${project.classes?.length} classes`);
await cold.page.screenshot({ path: join(evidenceDir, "checkpoint4-02-project-created.png") });
await closeAndCheck(cold.browser, "cold");

// Warm start.
await sleep(2000);
const warm = await launch("warm");
step("warm start reaches the Projects screen", true, `${result.launches[1].ms_to_projects} ms`);
await closeAndCheck(warm.browser, "warm");

writeFileSync(join(evidenceDir, "checkpoint4.json"), JSON.stringify(result, null, 2));
console.log("checkpoint 4 driver finished");
