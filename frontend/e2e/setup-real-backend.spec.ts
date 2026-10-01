import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { entrancesDone, evidencePath } from "./evidence";
import { setupUi, sortFolder, VERTICAL_TYPES } from "./fixtures/setupUi";

// Spec 2026-09-30-project-setup §12 against the real backend (plan 2026-09-30-setup-u6 Task 9): the
// real inspect job sorts generated DJI files, Create starts the real import jobs, the shared photo
// folder becomes one source, the one-page PDF is built unattended, and the Catalogue holds the
// template's types. Skipped in the gate; playwright.setup.config.ts sets E2E_SETUP_BACKEND.
test.skip(process.env.E2E_SETUP_BACKEND !== "1", "opt-in: pnpm -C frontend e2e:setup");

const API = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const auth = { Authorization: `Bearer ${process.env.E2E_API_TOKEN}` };

interface Data {
  delivery: string;
  photos: string;
  visual: string;
  thermal: string;
  drawing: string;
  junk: string;
}

async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const r = await request.get(`${API}${path}`, { headers: auth });
  expect(r.ok(), `GET ${path} answered ${r.status()}`).toBe(true);
  return (await r.json()) as T;
}

async function waitJob(request: APIRequestContext, pid: string, jobId: string): Promise<void> {
  await expect
    .poll(async () => (await get<{ state: string }>(request, `/projects/${pid}/jobs/${jobId}`)).state, {
      timeout: 120_000,
      intervals: [500],
    })
    .toBe("succeeded");
}

test("real backend: a vertical asset project from one delivery folder", async ({ page, request }) => {
  const root = join(process.env.E2E_DATA_DIR!, `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
  const data = JSON.parse(
    execFileSync(process.env.KESTREL_PYTHON!, ["scripts/make_setup_e2e_data.py", join(root, "delivery")], {
      cwd: "../backend",
    }).toString(),
  ) as Data;
  const sourcePosts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/v1\/projects\/[^/]+\/sources$/.test(new URL(r.url()).pathname))
      sourcePosts.push(r.url());
  });

  await page.goto("/projects");
  await setupUi.newProject(page).click();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await setupUi.template(page, "Vertical asset inspection").click();
  await setupUi.name(page).fill("Tower 14 setup");
  await setupUi.folder(page).fill(join(root, "project"));
  const inspected = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/v1/setup/inspect" && r.request().method() === "POST",
  );
  await sortFolder(page, data.delivery);
  expect((await inspected).status()).toBe(202);
  await expect(setupUi.slot(page, "Visual photos")).toContainText("1");
  await expect(setupUi.slot(page, "Thermal photos")).toContainText("1");
  await expect(setupUi.slot(page, "Asset drawings")).toContainText("1");
  await expect(setupUi.sharedFolderNote(page)).toBeVisible();
  if (process.env.E2E_CAPTURE_EVIDENCE === "1")
    await setupUi.slot(page, "Visual photos").evaluate((el) => el.scrollIntoView({ block: "center" }));
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("setup", "setup-sorted-real.png") });

  const created = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/v1/projects" && r.request().method() === "POST",
  );
  await setupUi.create(page).click();
  const createdResponse = await created;
  expect(createdResponse.status()).toBe(201);
  const pid = ((await createdResponse.json()) as { id: string }).id;
  await expect(page).toHaveURL(new RegExp(`/p/${pid}/overview$`));

  // The folder that holds both kinds is one source (S-R4), and its import runs to the end.
  type SourceRow = { id: string; folder: string; job_id: string | null };
  await expect
    .poll(async () => (await get<{ items: SourceRow[] }>(request, `/projects/${pid}/sources`)).items.length, {
      timeout: 30_000,
      intervals: [250],
    })
    .toBe(1);
  const [source] = (await get<{ items: SourceRow[] }>(request, `/projects/${pid}/sources`)).items;
  expect(source.folder.toLowerCase()).toBe(data.photos.toLowerCase());
  await waitJob(request, pid, source.job_id!);
  expect(
    (await get<{ image_count: number }>(request, `/projects/${pid}/sources/${source.id}`)).image_count,
  ).toBe(2);
  expect(sourcePosts).toHaveLength(1);

  // The one-page PDF was read and built with the Add data dialog's defaults (ruling U6-1).
  type DrawingRow = { name: string; job_id: string | null };
  await expect
    .poll(
      async () => (await get<{ items: DrawingRow[] }>(request, `/projects/${pid}/drawings`)).items.length,
      {
        timeout: 60_000,
        intervals: [500],
      },
    )
    .toBe(1);
  const [drawing] = (await get<{ items: DrawingRow[] }>(request, `/projects/${pid}/drawings`)).items;
  expect(drawing.name).toBe("tower-elevation");
  await waitJob(request, pid, drawing.job_id!);

  // The template's types, in order, with its hotkeys.
  const project = await get<{ classes: { name: string; hotkey: string | null }[] }>(
    request,
    `/projects/${pid}`,
  );
  expect(project.classes.map((c) => [c.name, c.hotkey])).toEqual(
    VERTICAL_TYPES.map(([name, , , hotkey]) => [name, hotkey]),
  );
  await expect(setupUi.notice(page)).toHaveCount(0);
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") {
    // Both jobs are done: reload so the Overview reads the landed data, then wait for it to show.
    await page.reload();
    await expect(page.getByRole("tab", { name: "Images 2" })).toBeVisible();
  }
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("setup", "overview-after-create-real.png"), fullPage: true });

  // Every type is in the app-wide Catalogue.
  await page.goto("/catalogue");
  for (const [name] of VERTICAL_TYPES)
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
});
