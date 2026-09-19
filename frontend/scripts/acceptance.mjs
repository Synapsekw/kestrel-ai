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
//   node scripts/acceptance.mjs --project-folder E:\tmp\dry --source E:\tmp\frames60 \
//     --expect-images 60 --expect-flights 0031 --epochs 1 --imgsz 640 --batch 2 \
//     --preannotate-images 3 --min-proposals 0 --min-query-boxes 0
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  minQueryBoxes: number("min-query-boxes", 1),
  cloudImages: number("cloud-images", 5),
  minCloudBoxes: number("min-cloud-boxes", 1),
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
const CLASS_NAMES = [
  "excavator",
  "wheel_loader",
  "bulldozer",
  "dump_truck",
  "crane",
  "concrete_mixer",
  "roller",
  "backhoe",
];
/** `ROW_HEIGHT` in frontend/src/data/ImageTable.tsx; the table is virtualised on that grid. */
const ROW_HEIGHT = 36;

const result = { project_id: null, steps: [], skipped: [], failed_step: null, config: cfg };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The step being worked on, so a throw from anywhere inside it names the right one. */
let current = "attach";
const begin = (name) => {
  current = name;
  return timer();
};

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

/**
 * One API call. `redact` keeps a response body out of the error message: the 422 handler echoes
 * the request value it rejected, which for the provider key endpoint would be the key itself.
 */
const api = async (method, path, body, { redact = false } = {}) => {
  const r = await fetch(`${info.base_url}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`${method} ${path} -> ${r.status} ${redact ? "<body redacted>" : text.slice(0, 300)}`);
  }
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

/** Opens a "More options"-style disclosure if it is closed; a no-op when it is already open. */
async function openDisclosure(scope, name) {
  const button = scope.getByRole("button", { name });
  if ((await button.getAttribute("aria-expanded")) === "false") await button.click();
}

/** The sidebar link, which is how a person moves between screens. */
async function openScreen(label, heading) {
  // Pipeline steps carry a count after their name ("Images 40"): match the name as a prefix.
  await page
    .getByRole("navigation")
    .getByRole("link", { name: new RegExp(`^${label}\\b`) })
    .first()
    .click();
  await page.getByRole("heading", { name: heading, exact: true }).waitFor({ timeout: 60_000 });
}

/** Poll a job to a terminal state, collecting the distinct progress lines seen on the way. */
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
 * The app's own event websocket (spec section 9), which is how the UI learns about progress.
 * Subscribe before the work starts and read `events` afterwards.
 */
async function openEventStream() {
  const url = `${info.base_url.replace(/^http/, "ws")}/api/v1/events?token=${encodeURIComponent(info.token)}`;
  const socket = new WebSocket(url);
  const events = [];
  socket.addEventListener("message", (e) => {
    try {
      events.push(JSON.parse(e.data));
    } catch {
      /* not our event */
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error(`could not open ${url.split("?")[0]}`)), {
      once: true,
    });
  });
  return { events, close: () => socket.close() };
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

/**
 * Open an image and wait for the editor's pre-annotation round trip, then return its boxes.
 *
 * The canvas appears as soon as the image record and its existing boxes have loaded; only then
 * does `useEditorImage` POST `/preannotate`, and that call takes seconds. Reading the boxes any
 * earlier undercounts the proposals. The hook skips pre-annotation when the image already has
 * unreviewed proposals, so the wait is skipped in exactly the same case.
 */
async function openAndPreannotate(projectId, imageId) {
  const before = await api("GET", `/projects/${projectId}/images/${imageId}/boxes`);
  const pending = before.items.some((b) => b.review_state === "unreviewed");
  const preannotated = pending
    ? Promise.resolve(null)
    : page.waitForResponse((r) => r.url().includes(`/images/${imageId}/preannotate`), {
        timeout: 300_000,
      });
  await openEditor(projectId, imageId);
  await preannotated;
  return api("GET", `/projects/${projectId}/images/${imageId}/boxes`);
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

const tableRow = (image) =>
  page.getByRole("row").filter({ has: page.getByLabel(`Select ${image.file_name}`) });

/**
 * Scroll the virtualised container until a row is mounted, and hand back its locator.
 *
 * One scroll is not enough: the list grows page by page, and a scrollTop past the current
 * `scrollHeight` is clamped, so a scroll issued before the rows arrived leaves the window at the
 * top and the row never mounts.
 */
async function clickRow(image, index, options = {}, timeoutMs = 60_000) {
  const locator = tableRow(image);
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    await page.getByTestId("image-table").evaluate((el, top) => {
      el.scrollTop = top;
    }, index * ROW_HEIGHT);
    await sleep(250);
    if ((await locator.count()) === 0) continue;
    try {
      await locator.click({ timeout: 5_000, ...options });
      return;
    } catch (e) {
      last = e; // the row was unmounted again between the check and the click; scroll back
    }
  }
  throw new Error(
    `row ${index} (${image.file_name}) never stayed in the virtualised window long enough to click: ${last}`,
  );
}

/**
 * Select the first `count` rows of the image table, which must already be showing exactly the
 * `total` images the caller's filter matches.
 *
 * The table renders only the rows in its viewport plus a small overscan, so ticking 30 or 50
 * checkboxes by label cannot work: rows past the window are not in the DOM at all. This uses the
 * table's own range selection instead - click the first row to set the anchor, shift-click the
 * last one - which needs only those two rows mounted.
 *
 * The range is resolved from the ids the table currently holds, so indexing an unfiltered list
 * would select the wrong images while the `N selected` count still matched. Opening the Data
 * Manager remounts it at `labeled: all` and it fetches a page before the filter is applied, so
 * two things are confirmed first: the filter bar reports the filtered total, and the row at the
 * top of the list is the caller's first image.
 */
async function selectRows(items, count, total) {
  if (items.length < count) throw new Error(`only ${items.length} rows listed, need ${count}`);
  await page.getByText(new RegExp(`of ${total} images`)).waitFor({ timeout: 120_000 });
  await page.waitForFunction(
    (n) => Number(document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount")) >= n,
    count,
    { timeout: 120_000 },
  );
  await page.getByTestId("image-table").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForFunction(
    (name) => {
      const rows = document.querySelectorAll('[data-testid="image-table"] [role="row"]');
      return rows.length > 0 && rows[0].textContent.includes(name);
    },
    items[0].file_name,
    { timeout: 60_000 },
  );

  await clickRow(items[0], 0);
  await clickRow(items[count - 1], count - 1, { modifiers: ["Shift"] });
  await page.getByText(`${count} selected`, { exact: true }).waitFor({ timeout: 30_000 });
}

async function importWeights(name, path) {
  await openDisclosure(page, "Import weights from a file");
  await page.getByLabel("Model name").fill(name);
  await page.getByLabel("Weights path").fill(path);
  await page.getByRole("button", { name: "Import weights", exact: true }).click();
  await page.getByTestId("model-detail").waitFor({ timeout: 300_000 });
}

/** Every box the run wrote, across its images. */
async function runBoxes(projectId, run) {
  const boxes = [];
  for (const imageId of run.image_ids) {
    const page1 = await api("GET", `/projects/${projectId}/images/${imageId}/boxes`);
    boxes.push(...page1.items.filter((b) => b.provenance.query_run_id === run.id));
  }
  return boxes;
}

const timer = () => {
  const t0 = Date.now();
  return () => Math.round((Date.now() - t0) / 100) / 10;
};

// Start from the Projects screen wherever the app was left (a resumed run reattaches to a
// window that is still on a project screen).
await go("/");
await page.getByRole("heading", { name: "Projects", exact: true }).waitFor({ timeout: 120_000 });

let projectId = cfg.projectId;
try {
  // -------------------------------------------------------------- 1. project
  let elapsed = begin("1. create or resume the project");
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

  // --------------------------------------------------------------- 2. import
  elapsed = begin("2. import the source folder");
  let stats = await api("GET", `/projects/${projectId}/stats`);
  if (stats.image_count === 0) {
    await page.getByRole("button", { name: "Import images" }).click();
    const dialog = page.getByRole("dialog", { name: "Import images" });
    await dialog.waitFor({ timeout: 15_000 });
    await dialog.getByLabel("Folder").fill(cfg.source);
    await dialog.getByLabel("Site name").fill(cfg.site);
    await dialog.getByRole("button", { name: "Start import" }).click();
    await page.getByTestId("import-notice").waitFor({ timeout: 30_000 }); // the banner reports the import; the jobs panel stays closed
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

  // ----------------------------------------------- 3. pre-annotation model
  elapsed = begin("3. pre-annotation model proposes on at least one of the opened images");
  await openScreen("Models", "Models");
  let models = await api("GET", `/projects/${projectId}/models`);
  let preModel = models.items.find((m) => m.name === "yolo11m-coco");
  if (!preModel) {
    await importWeights("yolo11m-coco", cfg.preannotateWeights);
    await page.getByRole("button", { name: "Use as pre-annotation model" }).click();
    await sleep(1500);
    preModel = (await api("GET", `/projects/${projectId}/models`)).items.find(
      (m) => m.name === "yolo11m-coco",
    );
  }
  // The editor only POSTs /preannotate when the project has a pre-annotation model, so this is
  // checked before the loop: otherwise the wait inside it would sit there for its full timeout.
  let projectAfterModel = await api("GET", `/projects/${projectId}`);
  for (let i = 0; i < 20 && projectAfterModel.preannotation_model_id !== preModel?.id; i++) {
    await sleep(500);
    projectAfterModel = await api("GET", `/projects/${projectId}`);
  }
  if (projectAfterModel.preannotation_model_id !== preModel?.id) {
    throw new Error(
      `the project's pre-annotation model is ${projectAfterModel.preannotation_model_id}, not ${preModel?.id}: "Use as pre-annotation model" did not take`,
    );
  }
  const page1 = await api("GET", `/projects/${projectId}/images?limit=${cfg.labelCount}&sort=path`);
  // Open images spread evenly across the whole import (by path, so across the flights) rather
  // than the first N: the first frames of a flight are the take-off run-in with nothing on them.
  const everyImage = [];
  for (let cursor = ""; ; ) {
    const pageN = await api("GET", `/projects/${projectId}/images?limit=1000&sort=path${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    everyImage.push(...pageN.items);
    if (!pageN.next_cursor) break;
    cursor = pageN.next_cursor;
  }
  const stride = Math.max(1, Math.floor(everyImage.length / cfg.preannotateImages));
  const toOpen = Array.from({ length: cfg.preannotateImages }, (_, i) => everyImage[Math.min(i * stride, everyImage.length - 1)]).filter(Boolean);
  let proposals = 0;
  for (const image of toOpen) {
    const boxes = await openAndPreannotate(projectId, image.id);
    proposals += boxes.items.filter((b) => b.provenance.kind === "local_model").length;
  }
  await shot(page, "03-preannotation");
  step(
    "3. pre-annotation model proposes on at least one of the opened images",
    preModel !== undefined &&
      projectAfterModel.preannotation_model_id === preModel.id &&
      proposals >= cfg.minProposals,
    `${preModel?.name} (${preModel?.class_names.length} classes), ${proposals} local_model proposals over ${cfg.preannotateImages} images (minimum ${cfg.minProposals})`,
    { seconds: elapsed(), proposals },
  );

  // ------------------------------------------------ 4. label and cut dataset
  elapsed = begin("4. label images and freeze dataset v1 by group");
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
    await openScreen("Images", "Images");
    await page.getByLabel("Labeled").selectOption("yes");
    await page.getByRole("radio", { name: "List" }).click();
    await page.getByTestId("image-table").waitFor({ timeout: 60_000 });
    const labeled = await api("GET", `/projects/${projectId}/images?labeled=true&limit=200&sort=path`);
    await selectRows(labeled.items, cfg.labelCount, labeled.total);
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
  // Close the loop on the selection: the dataset folder is flat and each file is named
  // `<site>__<file name>`, so its contents are the ids that were actually frozen.
  const labeledNow = await api("GET", `/projects/${projectId}/images?labeled=true&limit=200&sort=path`);
  const intendedFiles = new Set(labeledNow.items.slice(0, cfg.labelCount).map((i) => i.file_name));
  const frozenFiles = new Set(
    ["images/train", "images/val"]
      .flatMap((f) => (existsSync(join(datasetDir, f)) ? readdirSync(join(datasetDir, f)) : []))
      .map((name) => name.split("__").slice(1).join("__") || name),
  );
  const membersMatch =
    frozenFiles.size === intendedFiles.size && [...intendedFiles].every((f) => frozenFiles.has(f));
  await shot(page, "04-dataset");
  step(
    "4. label images and freeze dataset v1 by group",
    stats.labeled_count >= cfg.labelCount &&
      dataset.name === "v1" &&
      dataset.split_method === "by_group" &&
      dataset.train_count > 0 &&
      dataset.val_count > 0 &&
      dataset.train_count + dataset.val_count === cfg.labelCount &&
      folders.every((f) => existsSync(join(datasetDir, f))) &&
      /(^|\n)train:/.test(yamlText) &&
      /(^|\n)val:/.test(yamlText) &&
      CLASS_NAMES.every((name) => yamlText.includes(name)) &&
      membersMatch,
    `labeled ${stats.labeled_count}, train ${dataset.train_count} val ${dataset.val_count}, split ${dataset.split_method}, frozen images match the ${intendedFiles.size} labeled ones: ${membersMatch}`,
    { seconds: elapsed(), data_yaml: dataYaml },
  );

  // ---------------------------------------------------------------- 5. train
  elapsed = begin("5. train for the requested epochs and register the model");
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
  let progressEvents = [];
  if (!trained) {
    const stream = await openEventStream();
    try {
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
      await openDisclosure(page, /^More options/);
      await page.getByLabel("Epochs").fill(String(cfg.epochs));
      await page.getByLabel("Image size").fill(String(cfg.imgsz));
      await page.getByLabel("Automatic batch size").uncheck();
      await page.getByLabel("Batch size", { exact: true }).fill(String(cfg.batch));
      await page.getByRole("button", { name: "Start training" }).click();
      await page.getByTestId("train-progress").waitFor({ timeout: 60_000 });
      await page.waitForURL(/\?job=/, { timeout: 60_000 });
      const trainJobId = new URL(page.url()).searchParams.get("job");
      trainJob = await waitJob(projectId, trainJobId);
      if (trainJob.state !== "succeeded") throw new Error(`training failed: ${trainJob.error}`);
      await sleep(1500); // the last events are still in flight when the job row goes terminal
      progressEvents = stream.events.filter(
        (e) => e.type === "job.progress" && e.job_id === trainJobId,
      );
    } finally {
      stream.close();
    }
    trained = await api("GET", `/projects/${projectId}/models/${trainJob.result.model_id}`);
  }
  // The epoch card is the UI half of the evidence: it only reaches `n / N` because the same
  // progress events arrived in the page. A resumed run is not on the Train screen, so there is
  // nothing to read.
  const epochText =
    trainJob === null
      ? ""
      : (await page.getByTestId("epoch").innerText()).replace(/\s+/g, " ").trim();
  await shot(page, "05-training");
  step(
    "5. train for the requested epochs and register the model",
    trained.kind === "trained" &&
      typeof trained.metrics?.map50 === "number" &&
      typeof trained.metrics?.map50_95 === "number" &&
      (trainJob === null ||
        (progressEvents.length >= cfg.epochs && epochText === `${cfg.epochs} / ${cfg.epochs}`)),
    `model ${trained.name} mAP50 ${trained.metrics?.map50?.toFixed(4)} epoch card "${epochText}" job.progress events ${trainJob === null ? "resumed" : progressEvents.length}`,
    {
      seconds: elapsed(),
      metrics: trained.metrics,
      progress_events: progressEvents.map((e) => e.message),
    },
  );

  // ---------------------------------------- 6. query run, review, promote
  elapsed = begin("6. run the trained model over unlabeled images, review and promote");
  await openScreen("Images", "Images");
  await page.getByLabel("Labeled").selectOption("no");
  await page.getByRole("radio", { name: "List" }).click();
  await page.getByTestId("image-table").waitFor({ timeout: 60_000 });
  const unlabeled = await api(
    "GET",
    `/projects/${projectId}/images?labeled=false&limit=${cfg.queryImages}&sort=path`,
  );
  const intendedIds = new Set(unlabeled.items.slice(0, cfg.queryImages).map((i) => i.id));
  await selectRows(unlabeled.items, cfg.queryImages, unlabeled.total);
  await page.getByRole("button", { name: "Run model" }).click();
  await page.getByRole("heading", { name: "Detect", exact: true }).waitFor({ timeout: 60_000 });
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
  // Review: open the run's images in the review queue, which is where a person accepts or rejects.
  await page.getByRole("link", { name: "Review results" }).click();
  await page.getByRole("heading", { name: "Review", exact: true }).waitFor({ timeout: 60_000 });
  // The queue is virtualised, so its size is `aria-rowcount`, not the number of mounted rows;
  // it is read only once the list has loaded (the grid reports 0 rows while "Loading...").
  let reviewRows = 0;
  for (let i = 0; i < 120; i++) {
    reviewRows = await page
      .getByRole("grid")
      .getAttribute("aria-rowcount")
      .then(Number)
      .catch(() => 0);
    if (reviewRows > 0 || run.box_count === 0) break;
    await sleep(500);
  }
  await shot(page, "06-review");
  await page.goBack();
  await page.getByTestId("run-card").waitFor({ timeout: 60_000 });
  await page.getByLabel("Minimum confidence").fill("0");
  await page.getByRole("button", { name: "Accept as labels…" }).click();
  // Two steps since the usability wave: the card counts first, then asks.
  await page.getByRole("button", { name: /^Accept \d+ box(es)? as labels$/ }).click({ timeout: 60_000 });
  await sleep(2500);
  run = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
  await shot(page, "06-promoted");
  // Close the loop on the selection: these have to be the unlabelled images the driver picked,
  // not just fifty of something.
  const runsIntended =
    run.image_ids.length === intendedIds.size && run.image_ids.every((id) => intendedIds.has(id));
  step(
    "6. run the trained model over unlabeled images, review and promote",
    runsIntended && run.box_count >= cfg.minQueryBoxes && Boolean(run.promoted_at),
    `${run.image_ids.length} images (the intended unlabelled ones: ${runsIntended}), ${run.box_count} boxes (minimum ${cfg.minQueryBoxes}), ${reviewRows} rows in the review queue, promoted_at ${run.promoted_at}`,
    { seconds: elapsed(), box_count: run.box_count },
  );

  // ----------------------------------------------- 7. anthropic vision query
  elapsed = begin("7. anthropic vision query with tiling");
  const providers = await api("GET", "/providers");
  const anthropic = providers.items.find((p) => p.name === "anthropic");
  // An operator's stored key is used as it is and never replaced or deleted; only a key this run
  // put there from the environment is removed again.
  const alreadyStored = Boolean(anthropic?.has_key);
  const key = process.env.ANTHROPIC_API_KEY;
  if (alreadyStored || key) {
    if (!alreadyStored) {
      await api("PUT", "/providers/anthropic/key", { api_key: key }, { redact: true });
    }
    try {
      await openScreen("Detect", "Detect");
      await page
        .getByRole("button", { name: "New detection" })
        .click({ timeout: 3000 })
        .catch(() => {}); // only there when a run is open
      await page.getByRole("radio", { name: "Cloud provider" }).click();
      await page.getByLabel("Query", { exact: true }).fill("dump trucks");
      await page.getByLabel("Images", { exact: true }).selectOption({ label: "First N images" });
      await page.getByLabel("Number of images").fill(String(cfg.cloudImages));
      await openDisclosure(page, /^Tiling/);
      await page.getByLabel("Tile large images").check();
      await page.getByRole("button", { name: "Estimate" }).click();
      await page.getByTestId("estimate").waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: "Start" }).click();
      await page.waitForURL(/\?run=/, { timeout: 60_000 });
      const cloudRunId = new URL(page.url()).searchParams.get("run");
      let cloud = await api("GET", `/projects/${projectId}/query-runs/${cloudRunId}`);
      const cloudJob = await waitJob(projectId, cloud.job_id);
      if (cloudJob.state !== "succeeded") throw new Error(`anthropic run failed: ${cloudJob.error}`);
      cloud = await api("GET", `/projects/${projectId}/query-runs/${cloudRunId}`);
      const boxes = await runBoxes(projectId, cloud);
      const fromProvider = boxes.filter(
        (b) => b.provenance.kind === "cloud_provider" && b.provenance.provider === "anthropic",
      );
      await sleep(1500);
      await shot(page, "07-cloud-run");
      step(
        "7. anthropic vision query with tiling",
        cloud.image_ids.length === cfg.cloudImages &&
          cloud.tiling.enabled &&
          fromProvider.length >= cfg.minCloudBoxes,
        `${cloud.box_count} boxes, ${fromProvider.length} with anthropic provenance (minimum ${cfg.minCloudBoxes}), tiling ${cloud.tiling.tile_size}px, key ${alreadyStored ? "already stored" : "from the environment"}`,
        { seconds: elapsed(), box_count: cloud.box_count, provider_boxes: fromProvider.length },
      );
    } finally {
      if (!alreadyStored) await api("DELETE", "/providers/anthropic/key");
    }
  } else {
    result.skipped.push("7. anthropic vision query: ANTHROPIC_API_KEY is not set in the environment");
    console.log("SKIP 7. anthropic vision query (no ANTHROPIC_API_KEY)");
  }

  // ----------------------------------------------------------- 8. onnx export
  elapsed = begin("8. export the trained model to ONNX");
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
} catch (e) {
  result.failed_step = current;
  result.error = e instanceof Error ? e.message : String(e);
  throw e;
} finally {
  // Evidence for a failed run matters more than for a passing one.
  result.project_id = projectId || result.project_id;
  writeFileSync(join(cfg.evidence, "acceptance.json"), JSON.stringify(result, null, 2));
  const passed = result.steps.filter((s) => s.ok).length;
  console.log(`\nacceptance: ${passed} steps passed, ${result.skipped.length} skipped`);
  for (const s of result.skipped) console.log(`  skipped: ${s}`);
  if (result.error) console.log(`  failed in: ${result.failed_step}`);
  await browser.close();
}
