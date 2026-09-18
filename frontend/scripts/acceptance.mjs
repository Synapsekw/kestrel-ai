// Acceptance run (spec 13.5), steps 1-8, driven through the app's own UI over CDP.
//
// Attaches to a running app (installed or `pnpm tauri dev`) started with
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222, performs the eight steps
// with real UI actions and asserts the results through the API reached via `backend_info`.
// Screenshots and a JSON summary land in the evidence folder. `scripts/acceptance.md` is the
// prose version of the same run and the source of truth for what passing means.
//
// Usage:
//   node scripts/acceptance.mjs --project-folder E:\tmp\acceptance [--evidence docs\evidence\acceptance]
// Every expected value is a flag, so the script can be dry-run on a small copy of the frames:
//   node scripts/acceptance.mjs --project-folder E:\tmp\dry --source E:\tmp\frames20 \
//     --expect-images 20 --expect-flights 0031 --label-count 5 --epochs 1 --imgsz 640 \
//     --preannotate-images 3 --query-images 5 --cloud-images 2
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const number = (name, fallback) => Number(flag(name, String(fallback)));

const cfg = {
  projectFolder: flag("project-folder"),
  evidence: flag("evidence", "docs/evidence/acceptance"),
  projectName: flag("project-name", "Ahmadia"),
  source: flag("source", "E:\\Dev\\Yolo\\Ahmadia Construction Data"),
  site: flag("site", "ahmadia"),
  preannotateWeights: flag("preannotate-weights", "E:\\Dev\\Yolo\\models\\yolo11m.pt"),
  baseWeights: flag("base-weights", "E:\\Dev\\Yolo\\models\\yolo11n.pt"),
  expectImages: number("expect-images", 3299),
  expectDuplicates: number("expect-duplicates", 0),
  expectFlights: flag("expect-flights", "0031,0033,0034,0035,0038,0040,0042").split(",").filter(Boolean),
  preannotateImages: number("preannotate-images", 10),
  // Spec 13.5 step 3 expects proposals on at least one of the opened images; a dry run over a
  // handful of frames may legitimately see none, so the bar is a flag.
  minProposals: number("min-proposals", 1),
  labelCount: number("label-count", 30),
  epochs: number("epochs", 3),
  imgsz: number("imgsz", 1280),
  batch: number("batch", 4),
  queryImages: number("query-images", 50),
  cloudImages: number("cloud-images", 5),
  conf: flag("conf", "0.25"),
  importTimeoutMin: number("import-timeout-min", 60),
  // Resume a run whose project already exists (the 3299-frame import takes a while).
  projectId: flag("project-id", ""),
};
if (!cfg.projectFolder) {
  throw new Error("usage: acceptance.mjs --project-folder <folder> [--evidence <dir>] [see the header]");
}
mkdirSync(cfg.evidence, { recursive: true });

const CLASSES = 8;
const result = { project_id: null, steps: [], skipped: [], config: cfg };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function step(name, ok, detail = "", extra = {}) {
  result.steps.push({ name, ok, detail, ...extra });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
  if (!ok) throw new Error(`step failed: ${name}`);
}

const shot = (page, name) => page.screenshot({ path: join(cfg.evidence, `acceptance-${name}.png`) });

/** The webview of the running app: `127.0.0.1:1420` in dev, `tauri.localhost` when installed. */
async function connect() {
  for (let i = 0; i < 180; i++) {
    try {
      const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 2000 });
      const page = browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().includes("127.0.0.1:1420") || p.url().includes("tauri.localhost"));
      if (page) return { browser, page };
      await browser.close();
    } catch {
      /* the app is not up yet */
    }
    await sleep(1000);
  }
  throw new Error("could not attach to the app webview on port 9222");
}

const { browser, page } = await connect();
const info = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("backend_info"));

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

/**
 * Router navigation without a page load: the installed app is served from `tauri.localhost`,
 * where a deep URL is not a file the asset protocol can serve.
 */
async function go(path) {
  await page.evaluate((to) => {
    window.history.pushState({}, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

/** The sidebar link, which is how a person moves between screens. */
async function openScreen(label, heading) {
  await page.getByRole("link", { name: label, exact: true }).click();
  await page.getByRole("heading", { name: heading, exact: true }).waitFor({ timeout: 60_000 });
}

/** Poll a job to a terminal state, collecting the distinct progress messages seen on the way. */
async function waitJob(projectId, jobId, timeoutMs = 3_600_000) {
  const t0 = Date.now();
  const progress = [];
  while (Date.now() - t0 < timeoutMs) {
    const job = await api("GET", `/projects/${projectId}/jobs/${jobId}`);
    const line = `${job.progress.toFixed(2)} ${job.message}`;
    if (progress[progress.length - 1] !== line) progress.push(line);
    if (["succeeded", "failed", "cancelled"].includes(job.state)) return { ...job, progress };
    await sleep(1000);
  }
  throw new Error(`job ${jobId} timed out`);
}

/**
 * Open one image in the editor and wait until the canvas can take a drag.
 *
 * `data-view-scale` alone is not enough: it starts at the store's default 1 and only becomes the
 * fitted scale once the image record has arrived, so it reads "loaded" the instant the route
 * changes. `data-image` is set from the image record and the Konva stage only mounts once the
 * viewport is measured, so both together mean the background node exists.
 */
async function openEditor(projectId, imageId) {
  await go(`/p/${projectId}/edit/${imageId}`);
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="editor-canvas"]');
      return Boolean(el?.getAttribute("data-image")) && el.querySelectorAll("canvas").length > 0;
    },
    null,
    { timeout: 180_000 },
  );
}

const regionCount = () =>
  page.evaluate(() => document.querySelectorAll('[aria-label="Regions"] [role="listitem"]').length);

/**
 * One box drawn with the mouse, offset so repeated runs do not stack boxes on one spot.
 *
 * Pre-annotation runs on open and the full-size frame is still downloading behind the canvas, so
 * the first drag can land before the stage takes pointer events; the drag is repeated until a new
 * region shows up.
 */
async function drawBox(index, attempts = 3) {
  const canvas = page.getByTestId("editor-canvas");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const box = await canvas.boundingBox();
    const before = await regionCount();
    await page.keyboard.press("1");
    const x = box.x + box.width * (0.3 + 0.01 * (index % 10));
    const y = box.y + box.height * (0.3 + 0.01 * (index % 10));
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 140, y + 90, { steps: 8 });
    await page.mouse.up();
    try {
      await page.waitForFunction(
        (n) => document.querySelectorAll('[aria-label="Regions"] [role="listitem"]').length > n,
        before,
        { timeout: 15_000 },
      );
      return;
    } catch (e) {
      if (attempt === attempts) throw e;
      console.log(`  retrying the box on image ${index} (attempt ${attempt} drew nothing)`);
      await sleep(1000);
    }
  }
}

/** Tick `count` rows of the image table, scrolling each into view first. */
async function selectRows(items, count) {
  for (const image of items.slice(0, count)) {
    const cb = page.getByLabel(`Select ${image.file_name}`);
    await cb.scrollIntoViewIfNeeded();
    await cb.check();
  }
  await page.getByText(`${count} selected`).waitFor({ timeout: 15_000 });
}

async function importWeights(name, path) {
  await page.getByRole("button", { name: "Import weights" }).click();
  await page.getByLabel("Model name").fill(name);
  await page.getByLabel("Weights path").fill(path);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByTestId("model-detail").waitFor({ timeout: 300_000 });
}

// Start from the Projects screen wherever the app was left (a resumed run reattaches to a
// window that is still on a project screen).
await go("/");
await page.getByRole("heading", { name: "Projects" }).waitFor({ timeout: 120_000 });

const timer = () => {
  const t0 = Date.now();
  return () => Math.round((Date.now() - t0) / 100) / 10;
};

// ---------------------------------------------------------------- 1. project
let projectId = cfg.projectId;
let elapsed = timer();
if (projectId) {
  await go(`/p/${projectId}/data`);
  step("1. resume on an existing project", true, projectId);
} else {
  await page.fill("#project-name", cfg.projectName);
  await page.fill("#project-folder", cfg.projectFolder);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/p\/[0-9a-f-]+\/data/, { timeout: 60_000 });
  projectId = page.url().split("/p/")[1].split("/")[0];
  const project = await api("GET", `/projects/${projectId}`);
  await shot(page, "01-project");
  step(
    "1. create project with the eight classes",
    project.name === cfg.projectName && project.classes.length === CLASSES,
    `${projectId} classes ${project.classes.map((c) => c.name).join(",")}`,
    { seconds: elapsed() },
  );
}
result.project_id = projectId;

// ----------------------------------------------------------------- 2. import
elapsed = timer();
let stats = await api("GET", `/projects/${projectId}/stats`);
if (stats.image_count === 0) {
  await page.getByRole("button", { name: "Import images" }).click();
  const dialog = page.getByRole("dialog", { name: "Import images" });
  await dialog.waitFor({ timeout: 15_000 });
  await dialog.getByLabel("Folder").fill(cfg.source);
  await dialog.getByLabel("Site name").fill(cfg.site);
  await dialog.getByRole("button", { name: "Start import" }).click();
  await page.getByRole("dialog", { name: "Jobs" }).waitFor({ timeout: 30_000 });
  const jobs = await api("GET", `/projects/${projectId}/jobs?type=import`);
  const job = await waitJob(projectId, jobs.items[0].id, cfg.importTimeoutMin * 60_000);
  if (job.state !== "succeeded") throw new Error(`import failed: ${job.error}`);
  await page.keyboard.press("Escape");
  stats = await api("GET", `/projects/${projectId}/stats`);
}
await page.getByTestId("image-grid").waitFor({ timeout: 60_000 });
await shot(page, "02-import");
const flights = stats.groups.map((g) => g.group_key).sort();
step(
  "2. import the source folder",
  stats.image_count === cfg.expectImages &&
    stats.duplicate_count === cfg.expectDuplicates &&
    flights.length === cfg.expectFlights.length &&
    cfg.expectFlights.every((f) => flights.some((k) => k.includes(f))),
  `images ${stats.image_count} duplicates ${stats.duplicate_count} flights ${flights.join(",")}`,
  { seconds: elapsed(), image_count: stats.image_count, flights },
);

// ------------------------------------------------- 3. pre-annotation model
elapsed = timer();
await openScreen("Models", "Models");
let models = await api("GET", `/projects/${projectId}/models`);
let preModel = models.items.find((m) => m.name === "yolo11m-coco");
if (!preModel) {
  await importWeights("yolo11m-coco", cfg.preannotateWeights);
  await page.getByRole("button", { name: "Use as pre-annotation model" }).click();
  await sleep(1500);
  preModel = (await api("GET", `/projects/${projectId}/models`)).items.find((m) => m.name === "yolo11m-coco");
}
const projectAfterModel = await api("GET", `/projects/${projectId}`);
const page1 = await api("GET", `/projects/${projectId}/images?limit=${cfg.labelCount}&sort=path`);
let proposals = 0;
for (const image of page1.items.slice(0, cfg.preannotateImages)) {
  await openEditor(projectId, image.id);
  await sleep(500);
  const boxes = await api("GET", `/projects/${projectId}/images/${image.id}/boxes`);
  proposals += boxes.items.filter((b) => b.provenance.kind === "local_model").length;
}
await shot(page, "03-preannotation");
step(
  "3. pre-annotation model proposes on at least one of the opened images",
  preModel !== undefined &&
    projectAfterModel.preannotation_model_id === preModel.id &&
    proposals >= cfg.minProposals,
  `${preModel?.name} (${preModel?.class_names.length} classes), ${proposals} local_model proposals over ${cfg.preannotateImages} images`,
  { seconds: elapsed(), proposals },
);

// -------------------------------------------------- 4. label and cut dataset
elapsed = timer();
stats = await api("GET", `/projects/${projectId}/stats`);
if (stats.labeled_count < cfg.labelCount) {
  for (const [i, image] of page1.items.slice(0, cfg.labelCount).entries()) {
    await openEditor(projectId, image.id);
    await drawBox(i);
    await sleep(200);
  }
  stats = await api("GET", `/projects/${projectId}/stats`);
}
let datasets = await api("GET", `/projects/${projectId}/datasets`);
if (datasets.items.length === 0) {
  await openScreen("Data", "Data Manager");
  await page.getByLabel("Labeled").selectOption("yes");
  await page.getByRole("button", { name: "List" }).click();
  await page.getByTestId("image-table").waitFor({ timeout: 60_000 });
  const labeled = await api("GET", `/projects/${projectId}/images?labeled=true&limit=200&sort=path`);
  await selectRows(labeled.items, cfg.labelCount);
  await page.getByRole("button", { name: "Add to dataset" }).click();
  const dialog = page.getByRole("dialog", { name: "Add to dataset" });
  await dialog.waitFor({ timeout: 15_000 });
  await dialog.getByLabel("Dataset name").fill("v1");
  await dialog.getByRole("button", { name: "Create dataset" }).click();
  await page.getByTestId(/^job-/).first().waitFor({ timeout: 30_000 });
  const jobs = await api("GET", `/projects/${projectId}/jobs?type=dataset`);
  const job = await waitJob(projectId, jobs.items[0].id);
  if (job.state !== "succeeded") throw new Error(`dataset failed: ${job.error}`);
  datasets = await api("GET", `/projects/${projectId}/datasets`);
}
const dataset = datasets.items[0];
const datasetDir = join(cfg.projectFolder, dataset.path);
const dataYaml = join(datasetDir, "data.yaml");
const yamlText = existsSync(dataYaml) ? readFileSync(dataYaml, "utf8") : "";
writeFileSync(join(cfg.evidence, "acceptance-04-data-yaml.txt"), yamlText);
const folders = ["images/train", "images/val", "labels/train", "labels/val"];
await shot(page, "04-dataset");
step(
  "4. label images and freeze dataset v1 by group",
  stats.labeled_count >= cfg.labelCount &&
    dataset.name === "v1" &&
    dataset.train_count > 0 &&
    dataset.val_count > 0 &&
    dataset.train_count + dataset.val_count === cfg.labelCount &&
    folders.every((f) => existsSync(join(datasetDir, f))) &&
    /(^|\n)train:/.test(yamlText) &&
    /(^|\n)val:/.test(yamlText),
  `labeled ${stats.labeled_count}, train ${dataset.train_count} val ${dataset.val_count}, split ${dataset.split_method}`,
  { seconds: elapsed(), data_yaml: dataYaml },
);

// ------------------------------------------------------------------ 5. train
elapsed = timer();
await openScreen("Models", "Models");
models = await api("GET", `/projects/${projectId}/models`);
let baseModel = models.items.find((m) => m.name === "yolo11n-coco");
if (!baseModel) {
  await importWeights("yolo11n-coco", cfg.baseWeights);
  baseModel = (await api("GET", `/projects/${projectId}/models`)).items.find(
    (m) => m.name === "yolo11n-coco",
  );
}
let trained = models.items.find((m) => m.name === "ahmadia-v1");
let trainJob = null;
if (!trained) {
  await openScreen("Train", "Train");
  await page
    .getByLabel("Dataset", { exact: true })
    .locator("option", { hasText: "v1" })
    .waitFor({ state: "attached", timeout: 60_000 });
  await page
    .getByLabel("Base model", { exact: true })
    .locator("option", { hasText: "yolo11n-coco" })
    .waitFor({ state: "attached", timeout: 60_000 });
  await sleep(500);
  await page.getByLabel("Base model", { exact: true }).selectOption({ label: "yolo11n-coco (Imported)" });
  await page.getByLabel("Model name").fill("ahmadia-v1");
  await page.getByLabel("Epochs").fill(String(cfg.epochs));
  await page.getByLabel("Image size").fill(String(cfg.imgsz));
  await page.getByLabel("Automatic batch size").uncheck();
  await page.getByLabel("Batch size", { exact: true }).fill(String(cfg.batch));
  await page.getByRole("button", { name: "Start training" }).click();
  await page.getByTestId("train-progress").waitFor({ timeout: 60_000 });
  await page.waitForURL(/\?job=/, { timeout: 60_000 });
  trainJob = await waitJob(projectId, new URL(page.url()).searchParams.get("job"));
  if (trainJob.state !== "succeeded") throw new Error(`training failed: ${trainJob.error}`);
  trained = await api("GET", `/projects/${projectId}/models/${trainJob.result.model_id}`);
}
const epochText = await page
  .getByTestId("epoch")
  .innerText()
  .catch(() => "");
await shot(page, "05-training");
step(
  "5. train for the requested epochs and register the model",
  trained.kind === "trained" &&
    Boolean(trained.metrics) &&
    // Progress has to arrive and move: the poll sees the queued/running line and then at least
    // one epoch line. How many more depends on the epoch count and the poll interval.
    (trainJob === null || (trainJob.state === "succeeded" && trainJob.progress.length >= 2)),
  `model ${trained.name} mAP50 ${trained.metrics?.map50?.toFixed(4)} epoch card "${epochText.replace(/\s+/g, " ")}" progress updates ${trainJob?.progress.length ?? "resumed"}`,
  { seconds: elapsed(), metrics: trained.metrics, progress: trainJob?.progress ?? [] },
);

// -------------------------------------------- 6. query run, review, promote
elapsed = timer();
await openScreen("Data", "Data Manager");
await page.getByLabel("Labeled").selectOption("no");
await page.getByRole("button", { name: "List" }).click();
await page.getByTestId("image-table").waitFor({ timeout: 60_000 });
const unlabeled = await api(
  "GET",
  `/projects/${projectId}/images?labeled=false&limit=${cfg.queryImages}&sort=path`,
);
await selectRows(unlabeled.items, cfg.queryImages);
await page.getByRole("button", { name: "Run model" }).click();
await page.getByRole("heading", { name: "Query", exact: true }).waitFor({ timeout: 60_000 });
await page
  .getByLabel("Model", { exact: true })
  .locator("option", { hasText: trained.name })
  .waitFor({ state: "attached", timeout: 60_000 });
await page.getByLabel("Model", { exact: true }).selectOption({ label: `${trained.name} (Trained)` });
await page.getByLabel("Confidence", { exact: true }).fill(cfg.conf);
await page.getByRole("button", { name: "Estimate" }).click();
await page.getByTestId("estimate").waitFor({ timeout: 30_000 });
await page.getByRole("button", { name: "Start" }).click();
await page.waitForURL(/\?run=/, { timeout: 60_000 });
const runId = new URL(page.url()).searchParams.get("run");
let run = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
const inferJob = await waitJob(projectId, run.job_id);
if (inferJob.state !== "succeeded") throw new Error(`query run failed: ${inferJob.error}`);
run = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
await sleep(2000);
await shot(page, "06-query-run");
await page.getByRole("link", { name: "Review results" }).click();
await page.getByRole("heading", { name: "Review queue" }).waitFor({ timeout: 60_000 });
await shot(page, "06-review");
await page.goBack();
await page.getByTestId("run-card").waitFor({ timeout: 60_000 });
await page.getByLabel("Minimum confidence").fill("0");
await page.getByRole("button", { name: "Promote" }).click();
await sleep(2500);
run = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
await shot(page, "06-promoted");
step(
  "6. run the trained model over unlabeled images, review and promote",
  run.image_ids.length === cfg.queryImages && Boolean(run.promoted_at),
  `${run.image_ids.length} images, ${run.box_count} boxes, promoted_at ${run.promoted_at}`,
  { seconds: elapsed(), box_count: run.box_count },
);

// ------------------------------------------------- 7. anthropic vision query
elapsed = timer();
const key = process.env.ANTHROPIC_API_KEY;
if (key) {
  // The key only ever travels from the environment into Credential Manager and back out again.
  await api("PUT", "/providers/anthropic/key", { api_key: key });
  try {
    await openScreen("Query", "Query");
    await page
      .getByRole("button", { name: "New query" })
      .click({ timeout: 3000 })
      .catch(() => {}); // only there when a run is open
    await page.getByLabel("Cloud provider").check();
    await page.getByLabel("Query", { exact: true }).fill("dump trucks");
    await page.getByLabel("Images", { exact: true }).selectOption({ label: "First N images" });
    await page.getByLabel("Number of images").fill(String(cfg.cloudImages));
    await page.getByLabel("Tiling").check();
    await page.getByRole("button", { name: "Estimate" }).click();
    await page.getByTestId("estimate").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Start" }).click();
    await page.waitForURL(/\?run=/, { timeout: 60_000 });
    const cloudRunId = new URL(page.url()).searchParams.get("run");
    let cloud = await api("GET", `/projects/${projectId}/query-runs/${cloudRunId}`);
    const cloudJob = await waitJob(projectId, cloud.job_id);
    if (cloudJob.state !== "succeeded") throw new Error(`anthropic run failed: ${cloudJob.error}`);
    cloud = await api("GET", `/projects/${projectId}/query-runs/${cloudRunId}`);
    const boxes = await api(
      "GET",
      `/projects/${projectId}/images/${cloud.image_ids[0]}/boxes`,
    );
    const provided = boxes.items.filter((b) => b.provenance.kind === "cloud_provider");
    await sleep(1500);
    await shot(page, "07-cloud-run");
    step(
      "7. anthropic vision query with tiling",
      cloud.image_ids.length === cfg.cloudImages && cloud.tiling.enabled,
      `${cloud.box_count} boxes, tiling ${cloud.tiling.tile_size}px, provenance on the first image: ${JSON.stringify(provided[0]?.provenance ?? null)}`,
      { seconds: elapsed(), box_count: cloud.box_count },
    );
  } finally {
    await api("DELETE", "/providers/anthropic/key");
  }
} else {
  result.skipped.push("7. anthropic vision query: ANTHROPIC_API_KEY is not set in the environment");
  console.log("SKIP 7. anthropic vision query (no ANTHROPIC_API_KEY)");
}

// ------------------------------------------------------------- 8. onnx export
elapsed = timer();
await openScreen("Models", "Models");
await page.getByRole("button", { name: `Select model ${trained.name}` }).click();
await page.getByTestId("model-detail").waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Export ONNX" }).click();
await page.getByTestId(/^job-/).first().waitFor({ timeout: 30_000 });
const exportJobs = await api("GET", `/projects/${projectId}/jobs?type=export`);
const exportJob = await waitJob(projectId, exportJobs.items[0].id);
if (exportJob.state !== "succeeded") throw new Error(`export failed: ${exportJob.error}`);
const exported = await api("GET", `/projects/${projectId}/models/${trained.id}`);
const onnx = join(cfg.projectFolder, exported.exports.onnx ?? "");
await sleep(1000);
await shot(page, "08-export");
step(
  "8. export the trained model to ONNX",
  Boolean(exported.exports?.onnx) && existsSync(onnx) && exported.exports.onnx.startsWith("models/"),
  `${exported.exports?.onnx}`,
  { seconds: elapsed() },
);

writeFileSync(join(cfg.evidence, "acceptance.json"), JSON.stringify(result, null, 2));
console.log(`\nacceptance: ${result.steps.length} steps passed, ${result.skipped.length} skipped`);
for (const s of result.skipped) console.log(`  skipped: ${s}`);
await browser.close();
