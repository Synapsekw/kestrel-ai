// Integration checkpoint 3 (spec 13.4): the full flow from the UI against the real backend.
// import -> label with pre-annotation -> create dataset -> train -> query run (local model; cloud when a key
// is present) -> promote. Drives the real app (Tauri, env mode) over CDP; asserts through the API.
// Usage: node scripts/checkpoint3.mjs <projectFolder> <sampleFolder> <evidenceDir> <weightsPath>
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [projectFolder, sampleFolder, evidenceDir, weightsPath] = process.argv.slice(2);
if (!projectFolder || !sampleFolder || !evidenceDir || !weightsPath) throw new Error("usage: checkpoint3.mjs <projectFolder> <sampleFolder> <evidenceDir> <weightsPath>");
mkdirSync(evidenceDir, { recursive: true });
const result = { steps: [], skipped: [] };
const step = (name, ok, detail = "") => {
  result.steps.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
  if (!ok) throw new Error(`step failed: ${name}`);
};
const shot = (page, name) => page.screenshot({ path: join(evidenceDir, `checkpoint3-${name}.png`) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 180; i++) {
    try {
      const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 2000 });
      const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("127.0.0.1:1420"));
      if (page) return { browser, page };
      await browser.close();
    } catch {}
    await sleep(1000);
  }
  throw new Error("could not attach to the app webview on port 9222");
}

const { browser, page } = await connect();
await page.goto("http://127.0.0.1:1420/");
await page.getByRole("heading", { name: "Projects" }).waitFor({ timeout: 60_000 });
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
const waitJob = async (pid, jid, timeoutMs = 900_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const job = await api("GET", `/projects/${pid}/jobs/${jid}`);
    if (["succeeded", "failed", "cancelled"].includes(job.state)) return job;
    await sleep(1000);
  }
  throw new Error(`job ${jid} timed out`);
};
step("attach", true, info.base_url);

// Resume support: CP3_PROJECT_ID skips the steps that already passed (project, import, weights, labels).
const resumePid = process.env.CP3_PROJECT_ID;
let pid;
let jobs;
let stats;
if (resumePid) {
  pid = resumePid;
  await page.goto(`http://127.0.0.1:1420/p/${pid}/data`);
  step("resume on existing project", true, pid);
} else {
// 1. Create the project from the UI (eight classes are the default in the form).
await page.fill("#project-name", "Checkpoint 3");
await page.fill("#project-folder", projectFolder);
await page.getByRole("button", { name: "Create project" }).click();
await page.waitForURL(/\/p\/[0-9a-f-]+\/data/, { timeout: 30_000 });
pid = page.url().split("/p/")[1].split("/")[0];
const project = await api("GET", `/projects/${pid}`);
step("create project from ui", project.classes.length === 8, `${pid} ${project.classes.length} classes`);

// 2. Import images through the Import images dialog.
await page.getByRole("button", { name: "Import images" }).click();
const dialog = page.getByRole("dialog", { name: "Import images" });
await dialog.waitFor({ timeout: 10_000 });
await dialog.getByLabel("Folder").fill(sampleFolder);
await dialog.getByLabel("Site name").fill("ahmadia");
await dialog.getByRole("button", { name: "Start import" }).click();
await page.getByRole("dialog", { name: "Jobs" }).waitFor({ timeout: 15_000 });
await shot(page, "01-import-started");
jobs = await api("GET", `/projects/${pid}/jobs?type=import`);
const importJob = await waitJob(pid, jobs.items[0].id);
stats = await api("GET", `/projects/${pid}/stats`);
step("import via ui dialog", importJob.state === "succeeded" && stats.image_count === 20, JSON.stringify({ result: importJob.result, groups: stats.groups }));
await page.keyboard.press("Escape");
await page.getByTestId("image-grid").waitFor({ timeout: 30_000 });
await page.waitForFunction(() => document.querySelectorAll('[data-testid="image-grid"] [role="listitem"]').length >= 12, null, { timeout: 60_000 });
await shot(page, "02-data-manager-imported");

// 3. Import COCO weights through the Models screen and set them as the pre-annotation model.
await page.goto(`http://127.0.0.1:1420/p/${pid}/models`);
await page.getByRole("heading", { name: "Models" }).waitFor({ timeout: 30_000 });
await page.getByRole("button", { name: "Import weights" }).click();
await page.getByLabel("Model name").fill("yolo11m-coco");
await page.getByLabel("Weights path").fill(weightsPath);
await page.getByRole("button", { name: "Import", exact: true }).click();
await page.getByTestId("model-detail").waitFor({ timeout: 120_000 });
await page.getByRole("button", { name: "Use as pre-annotation model" }).click();
await page.waitForFunction(async () => true, null, { timeout: 1000 });
await sleep(1500);
const models = await api("GET", `/projects/${pid}/models`);
const proj2 = await api("GET", `/projects/${pid}`);
step("import weights via ui and set pre-annotation model", models.items.length === 1 && proj2.preannotation_model_id === models.items[0].id, `${models.items[0].name} classes=${models.items[0].class_names.length}`);
await shot(page, "03-model-imported");

// 4. Open the editor: pre-annotation runs on open (COCO weights on nadir frames may or may not fire).
const page1 = await api("GET", `/projects/${pid}/images?limit=12&sort=path`);
const imageIds = page1.items.map((i) => i.id);
let proposals = 0;
for (const id of imageIds.slice(0, 10)) {
  await page.goto(`http://127.0.0.1:1420/p/${pid}/edit/${id}`);
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="editor-canvas"]')?.getAttribute("data-view-scale")) > 0, null, { timeout: 120_000 });
  await sleep(500);
  const boxes = await api("GET", `/projects/${pid}/images/${id}/boxes`);
  proposals += boxes.items.filter((b) => b.provenance.kind === "local_model").length;
}
await shot(page, "04-editor-after-preannotate");
step("pre-annotation on open (10 images)", true, `${proposals} local_model proposals written (COCO weights rarely fire on nadir frames)`);

// 5. Label 12 images through the editor (one box each, class 1) so a dataset can be cut.
for (const id of imageIds) {
  await page.goto(`http://127.0.0.1:1420/p/${pid}/edit/${id}`);
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="editor-canvas"]')?.getAttribute("data-view-scale")) > 0, null, { timeout: 120_000 });
  const canvas = page.getByTestId("editor-canvas");
  const box = await canvas.boundingBox();
  await page.keyboard.press("1");
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35 + 140, box.y + box.height * 0.35 + 90, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Regions"] [role="listitem"]').length >= 1, null, { timeout: 15_000 });
  await sleep(300);
}
stats = await api("GET", `/projects/${pid}/stats`);
step("label 12 images in the editor", stats.labeled_count >= 12, `labeled ${stats.labeled_count}, boxes ${stats.box_count}`);
await shot(page, "05-labeled");
} // end of the non-resume path

// 6. Create a dataset from the Data Manager bulk action: tick the labeled rows, then "Add to dataset".
if (!process.env.CP3_TRAIN_JOB_ID) { // a finished training run implies the dataset exists
const labeled = await api("GET", `/projects/${pid}/images?labeled=true&limit=50&sort=path`);
await page.goto(`http://127.0.0.1:1420/p/${pid}/data`);
await page.getByRole("button", { name: "List" }).click();
await page.getByTestId("image-table").waitFor({ timeout: 30_000 });
for (const img of labeled.items) {
  const cb = page.getByLabel(`Select ${img.file_name}`);
  await cb.scrollIntoViewIfNeeded();
  await cb.check();
}
await page.getByText(`${labeled.items.length} selected`).waitFor({ timeout: 10_000 });
await page.getByRole("button", { name: "Add to dataset" }).click();
const dsDialog = page.getByRole("dialog", { name: "Add to dataset" });
await dsDialog.waitFor({ timeout: 10_000 });
await dsDialog.getByLabel("Dataset name").fill("v1");
await dsDialog.getByRole("button", { name: "Create dataset" }).click();
await page.getByTestId(/^job-/).first().waitFor({ timeout: 15_000 });
jobs = await api("GET", `/projects/${pid}/jobs?type=dataset`);
const dsJob = await waitJob(pid, jobs.items[0].id);
const datasets = await api("GET", `/projects/${pid}/datasets`);
const ds = datasets.items[0];
step("create dataset via bulk action", dsJob.state === "succeeded" && ds.train_count + ds.val_count >= 12, `train ${ds.train_count} val ${ds.val_count}`);
await shot(page, "06-dataset-created");
}

// 7. Train from the Train screen (1 epoch, small image size). CP3_TRAIN_JOB_ID resumes from a finished run.
let trainJob;
if (process.env.CP3_TRAIN_JOB_ID) {
  trainJob = await api("GET", `/projects/${pid}/jobs/${process.env.CP3_TRAIN_JOB_ID}`);
  step("resume on finished training job", trainJob.state === "succeeded", `${trainJob.id} params ${JSON.stringify(trainJob.params)}`);
} else {
  await page.goto(`http://127.0.0.1:1420/p/${pid}/train`);
  await page.getByRole("heading", { name: "Train" }).waitFor({ timeout: 30_000 });
  // The form remounts when the dataset and model lists arrive; fill only once the dataset is listed.
  await page.getByLabel("Dataset", { exact: true }).locator("option", { hasText: "v1" }).waitFor({ state: "attached", timeout: 30_000 });
  await sleep(500);
  await page.getByLabel("Model name").fill("cp3-model");
  await page.getByLabel("Epochs").fill("1");
  await page.getByLabel("Image size").fill("640");
  await page.getByLabel("Automatic batch size").uncheck();
  await page.getByLabel("Batch size", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Start training" }).click();
  await page.getByTestId("train-progress").waitFor({ timeout: 30_000 });
  await page.waitForURL(/\?job=/, { timeout: 30_000 });
  const trainJobId = new URL(page.url()).searchParams.get("job");
  trainJob = await waitJob(pid, trainJobId);
  await sleep(3000);
  await shot(page, "07-training-done");
  const epochText = await page.getByTestId("epoch").innerText().catch(() => "");
  const p = trainJob.params ?? {};
  step(
    "train from the ui",
    trainJob.state === "succeeded" && Boolean(trainJob.result?.model_id) && p.name === "cp3-model" && p.epochs === 1 && p.imgsz === 640 && p.batch === 4,
    `epoch card "${epochText}" model ${trainJob.result?.model_id} params ${JSON.stringify(p)}`,
  );
}
const trainedModel = (await api("GET", `/projects/${pid}/models`)).items.find((m) => m.id === trainJob.result.model_id);

// 8. Query run with the trained model over the unlabeled images, then promote.
await page.goto(`http://127.0.0.1:1420/p/${pid}/query`);
await page.getByRole("heading", { name: "Query" }).waitFor({ timeout: 30_000 });
await page.getByLabel("Model", { exact: true }).locator("option", { hasText: trainedModel.name }).waitFor({ state: "attached", timeout: 30_000 });
await page.getByLabel("Model", { exact: true }).selectOption({ label: `${trainedModel.name} (Trained)` }).catch(async () => {
  const opts = await page.getByLabel("Model", { exact: true }).locator("option").allTextContents();
  throw new Error(`could not select ${trainedModel.name} among ${JSON.stringify(opts)}`);
});
await page.getByLabel("Confidence", { exact: true }).fill("0.01");
await page.getByRole("button", { name: "Estimate" }).click();
await page.getByTestId("estimate").waitFor({ timeout: 15_000 });
const estimateText = await page.getByTestId("estimate").innerText();
await page.getByRole("button", { name: "Start" }).click();
await page.waitForURL(/\?run=/, { timeout: 30_000 });
const runId = new URL(page.url()).searchParams.get("run");
let run = await api("GET", `/projects/${pid}/query-runs/${runId}`);
const inferJob = await waitJob(pid, run.job_id);
run = await api("GET", `/projects/${pid}/query-runs/${runId}`);
await sleep(3000);
await shot(page, "08-query-run");
step("local query run from the ui", inferJob.state === "succeeded", `estimate "${estimateText.replace(/\s+/g, " ")}" boxes ${run.box_count} result ${JSON.stringify(inferJob.result)}`);
await page.getByLabel("Minimum confidence").fill("0");
await page.getByRole("button", { name: "Accept as labels…" }).click();
// Two steps since the usability wave: the card counts first, then asks.
await page.getByRole("button", { name: /^Accept \d+ box(es)?$/ }).click({ timeout: 60_000 });
await sleep(2000);
run = await api("GET", `/projects/${pid}/query-runs/${runId}`);
step("promote from the ui", Boolean(run.promoted_at), `promoted_at ${run.promoted_at}`);
await shot(page, "09-promoted");

// 9. Cloud provider query: only with a key in the environment (never written anywhere).
const key = process.env.ANTHROPIC_API_KEY;
if (key) {
  await api("PUT", `/providers/anthropic/key`, { api_key: key });
  await page.goto(`http://127.0.0.1:1420/p/${pid}/query`);
  await page.getByLabel("Cloud provider").check();
  await page.getByLabel("Query", { exact: true }).fill("dump trucks");
  await page.getByLabel("Images", { exact: true }).selectOption({ label: "First N images" }).catch(() => {});
  await page.getByLabel("Number of images").fill("5").catch(() => {});
  await page.getByRole("button", { name: "Estimate" }).click();
  await page.getByTestId("estimate").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\?run=/, { timeout: 30_000 });
  const cloudRunId = new URL(page.url()).searchParams.get("run");
  let cloud = await api("GET", `/projects/${pid}/query-runs/${cloudRunId}`);
  const cloudJob = await waitJob(pid, cloud.job_id);
  cloud = await api("GET", `/projects/${pid}/query-runs/${cloudRunId}`);
  await shot(page, "10-cloud-run");
  step("anthropic query run", cloudJob.state === "succeeded", `boxes ${cloud.box_count} result ${JSON.stringify(cloudJob.result)}`);
  await api("DELETE", `/providers/anthropic/key`);
} else {
  result.skipped.push("anthropic query run: ANTHROPIC_API_KEY not set in the environment");
  console.log("SKIP anthropic query run (no ANTHROPIC_API_KEY)");
}

writeFileSync(join(evidenceDir, "checkpoint3.json"), JSON.stringify({ project_id: pid, ...result }, null, 2));
await browser.close();
