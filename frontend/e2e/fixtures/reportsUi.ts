import { expect, type Locator, type Page, type Response } from "@playwright/test";

// Every Reports UI label the flows use, in one place (plan 2026-09-30-reports-r10, Task 2). The merged
// R6/R7/R8 components win: if one names a control differently, change it here, never in a flow.

export type SectionKey =
  | "cover"
  | "summary"
  | "findings_table"
  | "finding_pages"
  | "measurements"
  | "comparison"
  | "object_counts"
  | "appendix";

/** The SectionList row names (R7, `builderModel.ts` SECTION_LABEL). */
export const SECTION_LABEL: Record<SectionKey, string> = {
  cover: "Cover",
  summary: "Executive summary",
  findings_table: "Findings table",
  finding_pages: "Finding pages",
  measurements: "Measurements",
  comparison: "Survey comparison",
  object_counts: "Object counts",
  appendix: "Appendix",
};

/** The v2 delta strip (R2's summary composer, spec §17 flow 2). */
export const DELTA_SINCE_V1 = /1 closed\s*·\s*1 escalated since v1/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const ui = {
  /** The list header's button (the empty state has a second one; only one shows at a time). */
  newReport: (p: Page) => p.getByRole("button", { name: "New report", exact: true }),
  newDialog: (p: Page) => p.getByRole("dialog", { name: "New report" }),
  /** A template radio: its name also holds the description and "Built-in", so match the start. */
  templateRadio: (p: Page, name: string) =>
    ui.newDialog(p).getByRole("radio", { name: new RegExp(`^${escapeRe(name)}\\b`) }),
  sections: (p: Page) => p.getByRole("list", { name: "Sections", exact: true }),
  sectionRows: (p: Page) => ui.sections(p).getByRole("listitem"),
  /** A row is found by its switch (the section's name), never by free text in its options. */
  sectionRow: (p: Page, key: SectionKey) =>
    ui.sectionRows(p).filter({ has: p.getByRole("switch", { name: SECTION_LABEL[key], exact: true }) }),
  preview: (p: Page) => p.getByRole("region", { name: "Preview", exact: true }),
  /** One preview section (R6 `ReportPreview` SectionView), by its key. */
  previewSection: (p: Page, key: SectionKey) => ui.preview(p).locator(`[data-section-key="${key}"]`),
  /** A finding page's photos: "Photo n" or "Photo n: caption" (a placeholder `role=img` until loaded). */
  previewPhotos: (p: Page) => ui.preview(p).getByRole("img", { name: /^Photo \d/ }),
  previewFindings: (p: Page) => ui.preview(p).getByRole("article", { name: /^F-\d{4}\b/ }),
  filters: (p: Page) => p.getByRole("region", { name: "Filters", exact: true }),
  statusFilter: (p: Page, status: "Open" | "Reviewed" | "Closed") =>
    ui.filters(p).getByRole("checkbox", { name: status, exact: true }),
  dataItems: (p: Page) => ui.filters(p).getByRole("group", { name: "Data items" }),
  /** The top bar's save line (`role=status`): "Saving…" or "Saved". */
  saved: (p: Page) => p.getByRole("status").filter({ hasText: /^Saved$/ }),
  historyButton: (p: Page) => p.getByRole("button", { name: "History", exact: true }),
  history: (p: Page) => p.getByRole("dialog", { name: "History" }),
  /** A version row; its file list is a nested list, so the row is the item holding the `v<n>` label. */
  historyRow: (p: Page, n: number) =>
    ui
      .history(p)
      .getByRole("listitem")
      .filter({ has: p.getByText(`v${n}`, { exact: true }) }),
  results: (p: Page) => p.getByRole("region", { name: "Results", exact: true }),
  counts: (p: Page) => p.getByRole("region", { name: "Counts", exact: true }),
  surveyCountLink: (p: Page) => ui.counts(p).getByRole("link", { name: "Create a Survey count report" }),
};

const path = (r: Response) => new URL(r.url()).pathname;
const isOutline = (rid: string) => (r: Response) =>
  r.request().method() === "GET" && path(r).endsWith(`/reports/${rid}/outline`) && r.status() === 200;

/** Opens a report's builder and returns once its outline and eight section rows are there. */
export async function openBuilder(page: Page, pid: string, rid: string): Promise<void> {
  const outline = page.waitForResponse(isOutline(rid));
  await page.goto(`/p/${pid}/reports/${rid}`);
  await outline;
  await expect(ui.sectionRows(page)).toHaveCount(8);
}

/** Reports list → New report → template → title → Create report; returns the new report id. */
export async function createReportFromTemplate(
  page: Page,
  pid: string,
  templateName: string,
  title: string,
): Promise<string> {
  await expect(ui.newReport(page)).toBeEnabled();
  await ui.newReport(page).click();
  const dialog = ui.newDialog(page);
  await ui.templateRadio(page, templateName).check();
  await dialog.getByLabel("Title").fill(title);
  const created = page.waitForResponse(
    (r) => r.request().method() === "POST" && path(r).endsWith(`/projects/${pid}/reports`),
  );
  const outline = page.waitForResponse(
    (r) => r.request().method() === "GET" && /\/reports\/[^/]+\/outline$/.test(path(r)) && r.status() === 200,
  );
  await dialog.getByRole("button", { name: "Create report" }).click();
  const res = await created;
  expect(res.status(), await res.text()).toBe(201);
  const rid = ((await res.json()) as { id: string }).id;
  expect(path(await outline)).toContain(`/reports/${rid}/outline`);
  await expect(page).toHaveURL(new RegExp(`/p/${pid}/reports/${rid}$`));
  await expect(ui.sectionRows(page)).toHaveCount(8);
  return rid;
}

/**
 * Runs one edit and waits for the debounced `PATCH /reports/{rid}` and the outline refetch that
 * follows it (`useReportDraft`: 400 ms debounce, one PATCH in flight, `reloadOutline` after each
 * 200), then for the top bar to say "Saved" (nothing else waiting), so the next assertion sees the
 * edited preview.
 */
export async function editAndWait(
  page: Page,
  pid: string,
  rid: string,
  edit: () => Promise<void>,
): Promise<void> {
  let patchStatus = 0;
  const settled = page.waitForResponse((r) => {
    const p = path(r);
    if (r.request().method() === "PATCH" && p.endsWith(`/projects/${pid}/reports/${rid}`)) {
      patchStatus = r.status();
      return patchStatus !== 200; // a failed save ends the wait, and the expect below names it
    }
    return patchStatus === 200 && isOutline(rid)(r);
  });
  await edit();
  await settled;
  expect(patchStatus, "PATCH /reports/{rid}").toBe(200);
  await expect(ui.saved(page)).toBeVisible();
}

/** Finding pages → Options → Photos per finding = 0. */
export async function setPhotosOff(page: Page): Promise<void> {
  const row = ui.sectionRow(page, "finding_pages");
  const options = row.getByRole("button", { name: "Options", exact: true });
  if ((await options.getAttribute("aria-expanded")) !== "true") await options.click();
  const photos = row.getByLabel("Photos per finding");
  await photos.fill("0");
  await photos.press("Tab");
}

/**
 * SectionList keys in on-screen order. Each row's first switch carries the section's name; an open
 * Options disclosure adds more switches (e.g. "Context inset"), so only the first one per row counts.
 */
export async function sectionListOrder(page: Page): Promise<SectionKey[]> {
  const names = await ui
    .sectionRows(page)
    .evaluateAll((rows) => rows.map((row) => row.querySelector('[role="switch"]')?.textContent ?? ""));
  const keys = Object.keys(SECTION_LABEL) as SectionKey[];
  return names.map((t) => keys.find((k) => t.trim() === SECTION_LABEL[k])!);
}

/** Moves `key` up with Alt+↑ on its reorder handle until it sits above `above`. */
export async function moveSectionAbove(page: Page, key: SectionKey, above: SectionKey): Promise<void> {
  const handle = ui.sectionRow(page, key).getByRole("button", { name: `Reorder ${SECTION_LABEL[key]}` });
  await handle.focus();
  for (let i = 0; i < 8; i++) {
    const order = await sectionListOrder(page);
    if (order.indexOf(key) < order.indexOf(above)) return;
    // SectionList refocuses the moved row's control, so the next press lands on the same handle.
    await handle.press("Alt+ArrowUp");
    await expect.poll(async () => (await sectionListOrder(page)).indexOf(key)).toBe(order.indexOf(key) - 1);
  }
  throw new Error(`${key} did not move above ${above}`);
}

/** The preview shows the section titled `first` above the one titled `second` (R6's h3 section titles). */
export async function expectPreviewOrder(page: Page, first: string, second: string): Promise<void> {
  const heading = (name: string): Locator =>
    ui.preview(page).getByRole("heading", { level: 3, name, exact: true }).first();
  await expect(async () => {
    const a = await heading(first).boundingBox();
    const b = await heading(second).boundingBox();
    expect(a && b && a.y < b.y, `${first} above ${second}`).toBe(true);
  }).toPass();
}

/**
 * Brings the Finding pages section into the preview's own scroller and loads it: R6 loads a section
 * only within 1200 px of the scroller's viewport and a figure within 600 px, so each finding page is
 * scrolled to its end in turn (its photos sit last). Returns once the section is no longer busy and
 * every finding page has been on screen.
 */
export async function loadFindingPages(page: Page): Promise<void> {
  await ui
    .sectionRow(page, "finding_pages")
    .getByRole("button", { name: "Show Finding pages in preview" })
    .click();
  const section = ui.previewSection(page, "finding_pages");
  await expect(section).toHaveAttribute("aria-busy", "false");
  await expect(section.getByRole("status", { name: "Loading section" })).toHaveCount(0);
  const findings = section.getByRole("article");
  await expect(findings.first()).toBeVisible();
  for (const finding of await findings.all()) {
    await finding.evaluate((el) => el.scrollIntoView({ block: "end" }));
  }
}

const FORMAT_LABEL = { pdf: "PDF", csv: "CSV", xlsx: "XLSX" } as const;
type Format = keyof typeof FORMAT_LABEL;

/** Render split button: sets the formats in its menu (PDF is always on), renders, returns the queued job. */
export async function renderFromBuilder(page: Page, rid: string, formats: Format[]): Promise<{ id: string }> {
  await page.getByRole("button", { name: "Render options" }).click();
  const menu = page.getByRole("menu", { name: "Render formats" });
  for (const fmt of Object.keys(FORMAT_LABEL) as Format[]) {
    if (fmt === "pdf") continue;
    const item = menu.getByRole("menuitemcheckbox", { name: FORMAT_LABEL[fmt], exact: true });
    const checked = (await item.getAttribute("aria-checked")) === "true";
    if (checked !== formats.includes(fmt)) {
      await item.click();
      await expect(item).toHaveAttribute("aria-checked", String(!checked));
    }
  }
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  const posted = page.waitForResponse(
    (r) => r.request().method() === "POST" && path(r).endsWith(`/reports/${rid}/renders`),
  );
  await page.getByRole("button", { name: "Render", exact: true }).click();
  const res = await posted;
  expect(res.status(), await res.text()).toBe(202);
  const sent = ((res.request().postDataJSON() as { formats?: string[] }).formats ?? []).sort();
  expect(sent).toEqual([...new Set<string>(["pdf", ...formats])].sort());
  return ((await res.json()) as { job: { id: string } }).job;
}

/** Opens the History drawer (Render opens it by itself; the button is a toggle). */
export async function openHistory(page: Page): Promise<Locator> {
  const button = ui.historyButton(page);
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(ui.history(page)).toBeVisible();
  return ui.history(page);
}

/** Save as template → name → Save template; returns the POST /report-templates response. */
export async function saveAsTemplate(page: Page, name: string): Promise<Response> {
  await page.getByRole("button", { name: "Save as template" }).click();
  const dialog = page.getByRole("dialog", { name: "Save as template" });
  await expect(dialog).toContainText(/data-item filters.*are not kept/i);
  await dialog.getByLabel("Name").fill(name);
  const created = page.waitForResponse(
    (r) => r.request().method() === "POST" && path(r).endsWith("/report-templates"),
  );
  await dialog.getByRole("button", { name: "Save template" }).click();
  return created;
}
