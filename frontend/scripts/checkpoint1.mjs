// Drive the real Tauri app (WebView2) over CDP for integration checkpoint 1 (spec 13.4).
// Launch the app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 first.
// Usage: node scripts/checkpoint1.mjs <projectFolder> <evidenceDir> [launchEpochMs]
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [projectFolder, evidenceDir, launchEpochMs] = process.argv.slice(2);
if (!projectFolder || !evidenceDir) throw new Error("usage: checkpoint1.mjs <projectFolder> <evidenceDir> [launchEpochMs]");
mkdirSync(evidenceDir, { recursive: true });
const t0 = launchEpochMs ? Number(launchEpochMs) : Date.now();
const result = { steps: [] };
const step = (name, ok, detail = "") => {
  result.steps.push({ name, ok, detail, at_ms: Date.now() - t0 });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
};

async function connect() {
  for (let i = 0; i < 120; i++) {
    try {
      const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 2000 });
      const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("127.0.0.1:1420"));
      if (page) return { browser, page };
      await browser.close();
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("could not attach to the app webview on port 9222");
}

const { browser, page } = await connect();
step("attach webview", true, page.url());
await page.goto("http://127.0.0.1:1420/");

await page.getByRole("heading", { name: "Projects", exact: true }).waitFor({ timeout: 60_000 });
const bootMs = Date.now() - t0;
step("projects screen after health", true, `${bootMs} ms since launch`);
result.boot_ms = bootMs;
await page.screenshot({ path: join(evidenceDir, "checkpoint1-01-projects.png") });

await page.fill("#project-name", "Checkpoint One");
await page.fill("#project-folder", projectFolder);
await page.fill("#project-classes", "excavator\ndump_truck");
await page.getByRole("button", { name: "Create project" }).click();
await page.waitForURL(/\/p\/[0-9a-f-]+\/data/, { timeout: 30_000 });
const dbExists = existsSync(join(projectFolder, "project.db"));
step("create project via UI", dbExists, `${page.url()} project.db=${dbExists}`);
await page.screenshot({ path: join(evidenceDir, "checkpoint1-02-data-manager.png") });

// Kill the sidecar behind the app's back: the UI must show the blocking dialog (spec section 11).
// In `tauri dev` the sidecar runs as machinery-backend.exe; the bundle keeps the target-triple suffix.
const psList = "(Get-Process machinery-backend* -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName + ':' + $_.Id }) -join ','";
const sidecars = () => execSync(`powershell -NoProfile -Command "${psList}"`).toString().trim();
const before = sidecars();
step("sidecar process running", before.includes("machinery-backend"), before);
execSync('powershell -NoProfile -Command "Get-Process machinery-backend* | Stop-Process -Force"');
const dialog = page.getByRole("alertdialog");
await dialog.waitFor({ timeout: 15_000 });
const dialogText = await dialog.innerText();
step("crash dialog shown", /exited/i.test(dialogText), dialogText.replace(/\s+/g, " ").slice(0, 160));
await page.screenshot({ path: join(evidenceDir, "checkpoint1-03-sidecar-died.png") });

await page.getByRole("button", { name: "Restart" }).click();
await dialog.waitFor({ state: "detached", timeout: 60_000 });
await page.getByRole("heading").first().waitFor({ timeout: 60_000 });
const after = sidecars();
step("restart respawns sidecar", after.includes("machinery-backend") && after !== before, `${after}; heading: ${(await page.getByRole("heading").first().innerText()).trim()}`);
await page.screenshot({ path: join(evidenceDir, "checkpoint1-04-after-restart.png") });

writeFileSync(join(evidenceDir, "checkpoint1-result.json"), JSON.stringify(result, null, 2));
await browser.close();
process.exit(result.steps.every((s) => s.ok) ? 0 : 1);
