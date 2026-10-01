import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { evidencePath } from "./evidence";
import { api, seedInspectionProject, waitJob, type Json, type Seeded } from "./fixtures/reportsSeed";
import {
  ui,
  createReportFromTemplate,
  editAndWait,
  expectPreviewOrder,
  loadFindingPages,
  moveSectionAbove,
  openHistory,
  renderFromBuilder,
  sectionListOrder,
  setPhotosOff,
} from "./fixtures/reportsUi";

// Spec 2026-09-26-reports §17 flows 1-4 against the real backend (plan 2026-09-30-reports-r10,
// ruling R10-1). Serial: each flow continues from the previous one's report. Skipped in the gate;
// playwright.reports.config.ts sets E2E_REPORTS_BACKEND.
test.skip(process.env.E2E_REPORTS_BACKEND !== "1", "opt-in: pnpm -C frontend e2e:reports");
test.describe.configure({ mode: "serial" });

let seeded: Seeded;
let rid: string;
let v1Id: string;

const sectionKeys = (config: Json) => (config.sections as Json[]).map((s) => s.key as string);
const findingPagesOptions = (config: Json) =>
  (config.sections as Json[]).find((s) => s.key === "finding_pages")!.options as Json;

/** Finding numbers and their figures' snapshot keys, in block order. */
const findingShape = (blocks: Json[]) =>
  blocks
    .filter((b) => b.kind === "finding")
    .map((b) => ({ number: b.number, figures: (b.figures as Json[]).map((f) => f.snapshot.key) }));

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext();
  seeded = await seedInspectionProject(request, "Reports e2e");
  await request.dispose();
});

test("the seeded project has one image, one map and one cloud finding", async ({ request }) => {
  const page = await api(request, "GET", `/projects/${seeded.pid}/findings?limit=50`);
  const kinds = (page.items as { anchor: { kind: string } }[]).map((f) => f.anchor.kind).sort();
  expect(kinds).toEqual(["cloud", "image", "map"]);
});

test("flow 1: Full inspection report, photos off, Measurements above the table, render PDF + XLSX, issue v1", async ({
  page,
  request,
}) => {
  const { pid } = seeded;
  await page.goto(`/p/${pid}/reports`);
  rid = await createReportFromTemplate(page, pid, "Full inspection report", "North yard inspection");

  const outline0 = await api(request, "GET", `/projects/${pid}/reports/${rid}/outline`);
  expect(outline0.finding_count).toBe(3);
  await loadFindingPages(page);
  await expect(ui.previewPhotos(page)).toHaveCount(1); // the image finding's site photo

  // Ruling R10-3: closed findings stay in the report, so v2 can count a closure.
  await editAndWait(page, pid, rid, () => ui.statusFilter(page, "Closed").check());

  await editAndWait(page, pid, rid, () => setPhotosOff(page));
  await loadFindingPages(page);
  await expect(ui.previewPhotos(page)).toHaveCount(0);

  await editAndWait(page, pid, rid, () => moveSectionAbove(page, "measurements", "findings_table"));
  const order = await sectionListOrder(page);
  expect(order.indexOf("measurements")).toBeLessThan(order.indexOf("findings_table"));
  const outline = await api(request, "GET", `/projects/${pid}/reports/${rid}/outline`);
  const title = Object.fromEntries((outline.sections as Json[]).map((s) => [s.key, s.title as string]));
  await expectPreviewOrder(page, title.measurements, title.findings_table);
  await page.screenshot({ path: evidencePath("reports", "builder.png"), fullPage: true });

  // Review Focus 3: never render a config that is still being saved.
  await expect
    .poll(async () => {
      const cfg = (await api(request, "GET", `/projects/${pid}/reports/${rid}`)).config as Json;
      const keys = sectionKeys(cfg);
      return (
        findingPagesOptions(cfg).photos_max === 0 &&
        keys.indexOf("measurements") < keys.indexOf("findings_table") &&
        (cfg.filters.statuses as string[]).includes("closed")
      );
    })
    .toBe(true);

  const job = await renderFromBuilder(page, rid, ["pdf", "xlsx"]);
  await waitJob(request, pid, job.id, 240_000);

  const v1 = await api(request, "GET", `/projects/${pid}/reports/${rid}/versions/1`);
  v1Id = v1.id as string;
  expect(v1.state).toBe("ready");
  expect((v1.files as Json[]).map((f) => f.kind).sort()).toEqual(["pdf", "xlsx"]);
  const pdf = (v1.files as Json[]).find((f) => f.kind === "pdf")!;
  const xlsx = (v1.files as Json[]).find((f) => f.kind === "xlsx")!;
  expect(pdf.name).toMatch(/-v001\.pdf$/);
  expect(xlsx.name).toBe("findings.xlsx");
  expect(pdf.pages).toBeGreaterThanOrEqual(4); // cover + summary + three finding pages at least
  for (const f of v1.files as Json[]) expect(existsSync(join(seeded.folder, v1.folder, f.name))).toBe(true);
  expect(findingPagesOptions(v1.config).photos_max).toBe(0);
  expect(v1.config.filters.statuses).toContain("closed"); // ruling R10-3
  expect(sectionKeys(v1.config).indexOf("measurements")).toBeLessThan(
    sectionKeys(v1.config).indexOf("findings_table"),
  );

  // §18 criterion 2: the live preview's findings and figures are the frozen document's.
  const doc = JSON.parse(readFileSync(join(seeded.folder, v1.folder, "document.json"), "utf-8")) as Json;
  const frozen = (doc.sections as Json[]).find((s) => s.key === "finding_pages")!.blocks as Json[];
  const live = (
    await api(request, "GET", `/projects/${pid}/reports/${rid}/sections/finding_pages/blocks?limit=50`)
  ).items as Json[];
  expect(findingShape(live)).toEqual(findingShape(frozen));
  await loadFindingPages(page);
  for (const { number } of findingShape(frozen)) {
    await expect(ui.previewSection(page, "finding_pages")).toContainText(
      `F-${String(number).padStart(4, "0")}`,
    );
  }

  await openHistory(page);
  const row = ui.historyRow(page, 1);
  await expect(row).toContainText(String(pdf.pages));
  await expect(row).toContainText(pdf.name);
  await expect(row).toContainText("findings.xlsx");
  const issued = page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" && new URL(r.url()).pathname.endsWith(`/reports/${rid}/versions/1`),
  );
  await row.getByRole("button", { name: "Mark as issued" }).click();
  const issuedRes = await issued;
  expect(issuedRes.status()).toBe(200);
  // The issued version is the one rendered above (Task 4 keeps using v1Id).
  expect(((await issuedRes.json()) as Json).id).toBe(v1Id);
  await expect(row).toContainText("Issued");
  await page.screenshot({ path: evidencePath("reports", "history-v1.png"), fullPage: true });
});
