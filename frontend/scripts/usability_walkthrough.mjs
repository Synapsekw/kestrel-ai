// Usability walk-through (phase 2): replays the new-user flow on the real app over CDP and checks
// the fixes of docs/usability/2026-09-19-walkthrough.md. One screenshot per step.
//
// Start the app first with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
// (and WEBVIEW2_USER_DATA_FOLDER=<scratch> when another instance is already running), then:
//   node scripts/usability_walkthrough.mjs --project-folder <new folder> --frames <folder with jpgs>
//        --evidence <dir> [--label 12] [--epochs 3] [--port 9222]
// The frames folder must be a COPY of sample frames, never the original imagery.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const cfg = {
  projectFolder: args["project-folder"],
  frames: args.frames,
  evidence: args.evidence,
  label: Number(args.label ?? 12),
  epochs: String(args.epochs ?? 3),
  port: Number(args.port ?? 9222),
  // Resume on an existing project: steps 1-4 (create, import, starter model) are skipped.
  projectId: args["project-id"] ?? null,
  fromStep: Number(args["from-step"] ?? 1),
};
if (!cfg.projectFolder || !cfg.frames || !cfg.evidence) {
  throw new Error("usage: usability_walkthrough.mjs --project-folder <dir> --frames <dir> --evidence <dir>");
}
mkdirSync(cfg.evidence, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = { started: new Date().toISOString(), cfg, steps: [] };
let shotNo = 0;
const save = () => writeFileSync(join(cfg.evidence, "walkthrough.json"), JSON.stringify(result, null, 2));

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cfg.port}`, { timeout: 10_000 });
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => /tauri\.localhost|127\.0\.0\.1:1420/.test(p.url()));
if (!page) throw new Error("no app page on the debugging port");
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
const info = await page.evaluate(() => window.__TAURI_INTERNALS__?.invoke("backend_info")).catch(() => null);
const base = info?.base_url ?? process.env.APP_BACKEND_URL;
const token = info?.token ?? process.env.APP_BACKEND_TOKEN;
const api = async (method, path, body) => {
  const r = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

async function shot(name) {
  shotNo += 1;
  const file = `${String(shotNo).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: join(cfg.evidence, file) });
  return file;
}
async function step(name, fn) {
  if (Number(name.split(" ")[0]) < cfg.fromStep) {
    console.log(`SKIP ${name}`);
    return;
  }
  const entry = { name, ok: false, checks: [], screenshots: [] };
  result.steps.push(entry);
  const check = (what, ok, detail = "") => {
    entry.checks.push({ what, ok: Boolean(ok), detail: String(detail) });
    console.log(`  ${ok ? "ok  " : "FAIL"} ${what} ${detail}`);
    if (!ok) throw new Error(`${name}: ${what} ${detail}`);
  };
  console.log(`STEP ${name}`);
  try {
    await fn(check, async (n) => entry.screenshots.push(await shot(n)));
    entry.ok = true;
  } catch (e) {
    entry.error = String(e);
    entry.screenshots.push(await shot(`FAILED-${name.replace(/\W+/g, "-")}`).catch(() => "no screenshot"));
    save();
    throw e;
  }
  save();
}
const visible = (locator, timeout = 15_000) =>
  locator
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);

let projectId = cfg.projectId;
const urlIs = async (re, timeout = 20_000) => {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sleep(200)) if (re.test(page.url())) return true;
  throw new Error(`url never matched ${re}: ${page.url()}`);
};
if (projectId) await page.goto(new URL(`/p/${projectId}/data`, page.url()).href);

await step("1 projects screen explains itself; app settings work with no project", async (check, snap) => {
  await page.goto(new URL("/", page.url()).href);
  await page.getByRole("heading", { name: "Projects" }).waitFor();
  const nav = page.getByRole("navigation");
  check("sidebar says why the project entries are disabled", await visible(nav.getByText("Open or create a project to use these.")));
  check("disabled entry carries a tooltip", (await nav.getByText("Train", { exact: true }).getAttribute("title")) === "Open or create a project first");
  await snap("projects");
  await nav.getByRole("link", { name: "App settings" }).click();
  check("App settings opens without a project", await visible(page.getByRole("heading", { name: "App settings" })));
  check("provider cards are there", await visible(page.getByTestId("provider-anthropic")));
  await snap("app-settings");
  await nav.getByRole("link", { name: "Projects" }).click();
});

await step("2 create a project; a missing folder is named", async (check, snap) => {
  await page.fill("#project-name", "Usability walk-through");
  await page.getByRole("button", { name: "Create project" }).click();
  check("missing folder is named", await visible(page.getByRole("alert").filter({ hasText: "Choose a folder for the project." })));
  await page.fill("#project-folder", cfg.projectFolder);
  await page.getByRole("button", { name: "Create project" }).click();
  await urlIs(/\/p\/[0-9a-f-]+\/data/, 30_000);
  projectId = page.url().split("/p/")[1].split("/")[0];
  check("empty Data Manager offers the import", await visible(page.getByRole("button", { name: "Import a folder of images" })));
  await snap("empty-data-manager");
});

await step("3 import a folder; the banner ends with a summary", async (check, snap) => {
  await page.getByRole("button", { name: "Import a folder of images" }).click();
  const dialog = page.getByRole("dialog", { name: "Import images" });
  await dialog.getByLabel("Folder").fill(cfg.frames);
  check("preparation settings sit under Advanced", await visible(dialog.getByText("Advanced settings (the defaults suit most imports)")));
  await snap("import-dialog");
  await dialog.getByRole("button", { name: "Start import" }).click();
  check("jobs panel stays closed", !(await page.getByRole("dialog", { name: "Jobs" }).isVisible().catch(() => false)));
  const notice = page.getByTestId("import-notice");
  await notice.filter({ hasText: "Import finished" }).waitFor({ timeout: 600_000 });
  const text = await notice.innerText();
  check("summary names the images added", /Import finished: \d+ images? added/.test(text), text);
  await sleep(1500);
  const stats = await api("GET", `/projects/${projectId}/stats`);
  check("images are in the project", stats.image_count > 0, `${stats.image_count} images`);
  result.imageCount = stats.image_count;
  await snap("imported");
});

await step("4 add a starter model and use it for pre-annotation", async (check, snap) => {
  await page.getByRole("link", { name: "Models" }).click();
  check("starter models are offered", await visible(page.getByRole("heading", { name: "Starter models" })));
  await snap("models-starters");
  await page.getByRole("button", { name: "Add YOLO11 nano" }).click();
  check("the model is registered", await visible(page.getByRole("button", { name: "Select model yolo11n-coco" }), 120_000));
  const models = await api("GET", `/projects/${projectId}/models`);
  const nano = models.items.find((m) => m.name === "yolo11n-coco");
  check("truck is aliased to dump_truck", nano?.class_aliases?.truck === "dump_truck", JSON.stringify(nano?.class_aliases));
  await page.getByRole("button", { name: "Use as pre-annotation model" }).click();
  await sleep(1000);
  await snap("model-added");
});

await step(`5 label ${cfg.label} images in the editor`, async (check, snap) => {
  await page.getByRole("link", { name: "Data", exact: true }).click();
  await page.getByRole("button", { name: "List" }).click();
  await page.getByTestId("image-table").getByText(/\.jpg$/).first().dblclick();
  await urlIs(/\/edit\//);
  const status = page.getByRole("status");
  check("pre-annotation reports what it did", await visible(status.filter({ hasText: /pre-annotation model|Pre-annotating/ }), 60_000));
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  check("the shortcuts list opens on click", await visible(page.getByRole("dialog", { name: "Keyboard shortcuts" })));
  await snap("editor-shortcuts");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Keyboard shortcuts" }).getByRole("button", { name: "Close" }).click().catch(() => {});
  const canvas = page.locator("canvas").first();
  for (let i = 0; i < cfg.label; i++) {
    await canvas.waitFor();
    await sleep(1200);
    const bb = await canvas.boundingBox();
    const cx = bb.x + bb.width / 2;
    const cy = bb.y + bb.height / 2;
    for (const [k, dx] of [["1", -120], ["4", 40]]) {
      await page.keyboard.press(k);
      await page.mouse.move(cx + dx, cy - 30);
      await page.mouse.down();
      await page.mouse.move(cx + dx + 70, cy + 30, { steps: 6 });
      await page.mouse.up();
      await sleep(350);
    }
    if (i === 0) await snap("editor-labeled");
    if (i < cfg.label - 1) {
      await page.keyboard.press("Control+ArrowRight");
      await sleep(600);
    }
  }
  // One more image, without machinery: N marks it empty and it counts as labeled.
  await page.keyboard.press("Control+ArrowRight");
  await sleep(1500);
  const before = await api("GET", `/projects/${projectId}/stats`);
  await page.keyboard.press("n");
  const toggle = page.getByRole("button", { name: /Marked empty/ });
  check("N marks the image as empty", await visible(toggle));
  check("the toggle shows its state", (await toggle.getAttribute("aria-pressed")) === "true");
  await snap("editor-marked-empty");
  await sleep(1500);
  const stats = await api("GET", `/projects/${projectId}/stats`);
  check("an empty image counts as labeled", stats.labeled_count === before.labeled_count + 1, `${before.labeled_count} -> ${stats.labeled_count}`);
  check("labeled images are counted", stats.labeled_count >= cfg.label + 1, `${stats.labeled_count} labeled`);
  const back = page.getByRole("link", { name: "Back to the Data Manager" });
  check("the editor has a way back", await visible(back));
  await back.click();
  await urlIs(/\/data$/);
});

await step("6 dataset from the labeled images; a bad name is explained", async (check, snap) => {
  await page.getByLabel("Labeled").selectOption("yes");
  await sleep(1500);
  await page.getByRole("button", { name: /^Select all \d+$/ }).click();
  await page.getByRole("button", { name: "Add to dataset" }).click();
  const dialog = page.getByRole("dialog", { name: "Add to dataset" });
  check("the dialog counts the empty image as a negative example", /1 of them marked empty, used as negative examples/.test(await dialog.innerText()));
  await dialog.getByLabel("Dataset name").fill("first set");
  await dialog.getByRole("button", { name: "Create dataset" }).click();
  check("a name with a space is explained", await visible(page.getByRole("alert").filter({ hasText: "letters, digits, dot, dash and underscore" })));
  await snap("dataset-name-explained");
  await dialog.getByLabel("Dataset name").fill("v1");
  await dialog.getByLabel("Split method").selectOption("random");
  await dialog.getByRole("button", { name: "Create dataset" }).click();
  const train = page.getByRole("link", { name: "Train on it" }).first();
  check("the dataset job ends with a way to train", await visible(train, 120_000));
  await snap("dataset-created");
  await train.click();
  await urlIs(/\/train/);
});

await step("7 train: guidance before, honest verdict after", async (check, snap) => {
  await page.getByLabel("Base model").selectOption({ index: 1 });
  check("a tiny dataset is called out", await visible(page.getByTestId("train-advice")));
  check("parameters are explained", await visible(page.getByText(/Passes over the training images/)));
  await page.getByLabel("Epochs").fill(cfg.epochs);
  await page.getByLabel("Image size").fill("640");
  await snap("train-form");
  await page.getByRole("button", { name: "Start training" }).click();
  const progress = page.getByTestId("train-progress");
  await progress.waitFor({ timeout: 30_000 });
  await progress.getByText(/Training (finished|failed|cancelled)/).waitFor({ timeout: 1_800_000 });
  const text = await progress.innerText();
  check("training finished", /Training finished/.test(text), text.slice(0, 120));
  check("the log reads as sentences", !/\{"kind"/.test(text), "no raw JSON records");
  const map50 = Number((await page.getByTestId("map50").innerText()).replace("%", "")) / 100;
  const warned = await page.getByTestId("result-advice").isVisible().catch(() => false);
  check("a weak model is called out, a usable one is not", map50 < 0.05 ? warned : !warned, `mAP50 ${map50}, warned ${warned}`);
  result.map50 = map50;
  await snap("train-done");
});

await step("8 run the trained model; review; accept as labels with a count; undo", async (check, snap) => {
  const card = page.getByTestId("run-card");
  // Runs one local detection with the model whose option matches `kind`; returns the run.
  const detect = async (kind, shotName) => {
    await page.getByRole("link", { name: "Query" }).click();
    const again = page.getByRole("button", { name: "New query" });
    if (await again.isVisible().catch(() => false)) await again.click();
    const model = page.getByLabel("Model", { exact: true });
    // The list loads after the screen: wait for the model before choosing it.
    await model.locator("option", { hasText: kind }).first().waitFor({ state: "attached", timeout: 30_000 });
    const label = (await model.locator("option").allInnerTexts()).find((o) => o.includes(kind));
    await model.selectOption({ label });
    await page.getByLabel("Confidence", { exact: true }).fill("0.01");
    check("a local run explains that it is free", await visible(page.getByText(/Runs on this computer at no cost/)));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await card.waitFor({ timeout: 30_000 });
    await card.getByTestId("box-count").filter({ hasText: "found" }).waitFor({ timeout: 1_800_000 });
    const count = await card.getByTestId("box-count").innerText();
    await snap(shotName);
    const id = new URL(page.url()).searchParams.get("run");
    const found = await api("GET", `/projects/${projectId}/query-runs/${id}`);
    check(`card shows the final count (${label})`, count.startsWith(`${found.box_count} `), `${count} / api ${found.box_count}`);
    await sleep(1500);
    check("history shows the same count", await visible(page.getByTestId("run-history").getByText(new RegExp(`${found.box_count} boxes`))));
    return found;
  };
  let run = await detect("(Trained)", "query-trained-model");
  if (run.box_count === 0) {
    // A model trained for a few epochs on a dozen images is rarely sure of anything.
    check("an empty run says why", await visible(page.getByTestId("no-boxes-advice")));
    run = await detect("(Imported)", "query-starter-model");
    check("the starter model proposes something to review", run.box_count > 0, `${run.box_count} boxes`);
  }
  const runId = run.id;
  await card.getByLabel("Minimum confidence").fill("0");
  await card.getByRole("button", { name: "Accept as labels…" }).click();
  const confirm = page.getByTestId("promote-confirm");
  check("the count is shown before anything is accepted", await visible(confirm));
  const before = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
  check("nothing accepted yet", before.promoted_at === null);
  await snap("accept-confirm");
  await confirm.getByRole("button", { name: /^Accept \d+ box(es)?$/ }).click();
  check("accepted", await visible(card.getByText("Accepted as labels")));
  await card.getByRole("button", { name: "Undo acceptance" }).click();
  check("undone", await visible(page.getByRole("status").filter({ hasText: "returned to unreviewed" })));
  const after = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
  check("the run is no longer promoted", after.promoted_at === null);
  await snap("accept-undone");
  await card.getByRole("link", { name: "Review results" }).click();
  check("the review names how many images still wait", await visible(page.getByTestId("run-filter").filter({ hasText: "still have proposals" })));
  await snap("review-of-the-run");
  await page.getByTestId("image-table").getByText(/\.jpg$/).first().dblclick();
  await urlIs(/\/edit\//);
  const back = page.getByRole("link", { name: "Back to the review queue" });
  check("the editor leads back to this review", (await back.getAttribute("href"))?.includes("ids="), await back.getAttribute("href"));
  await back.click();
});

await step("9 export the trained model to ONNX", async (check, snap) => {
  await page.getByRole("link", { name: "Models" }).click();
  await page.getByRole("button", { name: /^Select model v1-/ }).first().click();
  await page.getByRole("button", { name: "Export ONNX" }).click();
  check("the ONNX file is listed", await visible(page.getByText(/\.onnx/), 600_000));
  await snap("onnx-exported");
});

await step("10 no IPC errors in the console", async (check) => {
  const ipc = consoleErrors.filter((e) => /ipc\.localhost|Content Security Policy/.test(e));
  check("the CSP lets Tauri's IPC through", ipc.length === 0, ipc[0] ?? "");
});

result.finished = new Date().toISOString();
result.passed = result.steps.every((s) => s.ok);
save();
console.log(result.passed ? "WALK-THROUGH PASSED" : "WALK-THROUGH FAILED");
await browser.close();
