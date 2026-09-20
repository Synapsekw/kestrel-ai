// Integration checkpoint 2, editor half (spec 13.4): open the editor against the real backend inside the
// real Tauri app, draw a box, undo/redo it, navigate. Data is set up through the real API.
// Launch the app first: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 pnpm tauri dev
// Usage: node scripts/checkpoint2_editor.mjs <projectFolder> <sampleFolder> <evidenceDir>
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [projectFolder, sampleFolder, evidenceDir] = process.argv.slice(2);
if (!projectFolder || !sampleFolder || !evidenceDir) throw new Error("usage: checkpoint2_editor.mjs <projectFolder> <sampleFolder> <evidenceDir>");
mkdirSync(evidenceDir, { recursive: true });
const result = { steps: [] };
const step = (name, ok, detail = "") => {
  result.steps.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
  if (!ok) throw new Error(`step failed: ${name}`);
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
await page.goto("http://127.0.0.1:1420/");
await page.getByRole("heading", { name: "Projects", exact: true }).waitFor({ timeout: 60_000 });
const info = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("backend_info"));
step("attach and read backend info", Boolean(info.base_url && info.token), info.base_url);

const api = async (method, path, body) => {
  const r = await fetch(`${info.base_url}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};

// Data setup through the real API: project with the eight classes, import the sample frames.
const classes = ["excavator", "wheel_loader", "bulldozer", "dump_truck", "crane", "concrete_mixer", "roller", "backhoe"].map((n, i) => ({
  name: n,
  colour: ["#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#ef4444"][i],
  hotkey: String(i + 1),
}));
const project = await api("POST", "/projects", { name: "Checkpoint 2 editor", folder: projectFolder, classes });
const created = await api("POST", `/projects/${project.id}/sources`, { folder: sampleFolder, site: "ahmadia" });
for (let i = 0; i < 600; i++) {
  const job = await api("GET", `/projects/${project.id}/jobs/${created.job.id}`);
  if (job.state === "succeeded") break;
  if (job.state === "failed" || job.state === "cancelled") throw new Error(`import ${job.state}: ${job.error}`);
  await new Promise((r) => setTimeout(r, 500));
}
const stats = await api("GET", `/projects/${project.id}/stats`);
step("import via api", stats.image_count > 0, `${stats.image_count} images`);

// Open the project from the UI and reach the Data Manager against the real backend.
await page.fill("#open-folder", projectFolder);
await page.getByRole("button", { name: "Open folder" }).click();
await page.waitForURL(/\/p\/[0-9a-f-]+\/data/, { timeout: 30_000 });
const grid = page.getByTestId("image-grid");
await grid.waitFor({ timeout: 30_000 });
await page.waitForFunction((n) => document.querySelectorAll('[data-testid="image-grid"] [role="listitem"]').length >= n, Math.min(stats.image_count, 12), { timeout: 30_000 });
const cells = await grid.getByRole("listitem").count();
step("data manager lists real images", cells > 0, `${cells} cells rendered (virtualised)`);
await page.screenshot({ path: join(evidenceDir, "checkpoint2-01-data-manager.png") });

// Open the first image with Enter, then draw, undo, redo.
await grid.click({ position: { x: 20, y: 20 } });
await grid.press("Enter");
await page.waitForURL(/\/p\/[0-9a-f-]+\/edit\/[0-9a-f-]+/, { timeout: 30_000 });
const imageId = page.url().split("/edit/")[1].split(/[?#]/)[0];
const canvas = page.getByTestId("editor-canvas");
await canvas.waitFor({ timeout: 30_000 });
await page.waitForFunction(() => Number(document.querySelector('[data-testid="editor-canvas"]')?.getAttribute("data-view-scale")) > 0, null, { timeout: 60_000 });
await page.waitForTimeout(1500); // let the image bitmap and the (501) pre-annotate call settle
await page.screenshot({ path: join(evidenceDir, "checkpoint2-02-editor-open.png") });
step("editor opened against the real backend", true, imageId);

const box = await canvas.boundingBox();
await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.3 + 120, box.y + box.height * 0.3 + 80, { steps: 8 });
await page.mouse.up();
await page.getByRole("list", { name: "Regions" }).getByRole("listitem").first().waitFor({ timeout: 15_000 });
let boxes = await api("GET", `/projects/${project.id}/images/${imageId}/boxes`);
step("draw box persists through the api", boxes.items.length === 1 && boxes.items[0].provenance.kind === "person" && boxes.items[0].review_state === "accepted", JSON.stringify(boxes.items[0] ?? null).slice(0, 200));
await page.screenshot({ path: join(evidenceDir, "checkpoint2-03-box-drawn.png") });

await page.keyboard.press("Control+z");
await page.waitForFunction(() => document.querySelectorAll('[aria-label="Regions"] [role="listitem"]').length === 0, null, { timeout: 15_000 });
boxes = await api("GET", `/projects/${project.id}/images/${imageId}/boxes`);
step("undo deletes the box on the server", boxes.items.length === 0, `${boxes.items.length} boxes`);
await page.keyboard.press("Control+y");
await page.waitForFunction(() => document.querySelectorAll('[aria-label="Regions"] [role="listitem"]').length === 1, null, { timeout: 15_000 });
boxes = await api("GET", `/projects/${project.id}/images/${imageId}/boxes`);
step("redo recreates the box on the server", boxes.items.length === 1, `${boxes.items.length} boxes`);

await page.keyboard.press("Control+ArrowRight");
await page.waitForURL((u) => u.pathname.includes("/edit/") && !u.pathname.endsWith(imageId), { timeout: 30_000 });
step("ctrl+right navigates to the next image", true, page.url());
await page.screenshot({ path: join(evidenceDir, "checkpoint2-04-next-image.png") });

const pstats = await api("GET", `/projects/${project.id}/stats`);
step("stats reflect the label", pstats.labeled_count === 1 && pstats.box_count === 1, JSON.stringify({ labeled: pstats.labeled_count, boxes: pstats.box_count }));
writeFileSync(join(evidenceDir, "checkpoint2-editor.json"), JSON.stringify({ project_id: project.id, image_id: imageId, ...result }, null, 2));
await browser.close();
