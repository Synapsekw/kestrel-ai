import { test, expect, type Page } from "@playwright/test";
import { jsonReply } from "./mock";

// R7 builder against the Prism mock. Every reports endpoint is answered by page.route, so the flow
// does not depend on R1/R2/R5 being merged. R10's reports-real-backend.spec.ts covers the real backend.
const P = "7f1c2e3a-1111-4000-8000-000000000001";
const R = "r0000000-9999-4000-8000-000000000001";
const JOB = "j0000000-4444-4000-8000-000000000071";
const V = "ve000000-1111-4000-8000-000000000001";

const SECTIONS = [
  { key: "cover", enabled: true, options: { show_locator: true } },
  { key: "summary", enabled: true, options: { narrative: "", show_deltas: true } },
  {
    key: "findings_table",
    enabled: true,
    options: { columns: ["number", "type", "severity"], sort: "severity_desc" },
  },
  {
    key: "finding_pages",
    enabled: true,
    options: { snapshots: ["image", "map", "cloud"], photos_max: 4, comments: "last", context_inset: true },
  },
  {
    key: "measurements",
    enabled: true,
    options: { kinds: ["length", "area", "volume"], snapshots: true, measurement_ids: null },
  },
  { key: "comparison", enabled: false, options: { pairs: "auto", mode: "both", counts_chart: true } },
  { key: "object_counts", enabled: false, options: { type_ids: null, per_area: true, verified_only: false } },
  { key: "appendix", enabled: true, options: { include_methods: true } },
];
const CONFIG = {
  cover: {
    title: "Findings summary",
    subtitle: null,
    site: null,
    client: null,
    author: "Site engineer",
    logo_asset_id: null,
    report_date: null,
  },
  paper: { size: "A4", orientation: "portrait" },
  filters: {
    severity_min: null,
    include_ungraded: true,
    statuses: ["open", "reviewed"],
    type_ids: null,
    data_item_ids: null,
    date: { rule: "all", from: null, to: null, days: null },
  },
  sections: SECTIONS,
};
const TEMPLATES = [
  ["builtin-full", "Full inspection report"],
  ["builtin-findings-summary", "Findings summary"],
  ["builtin-survey-counts", "Survey count report"],
  ["builtin-volumes", "Volumes report"],
].map(([id, name]) => ({
  id,
  name,
  description: "",
  builtin: true,
  config: CONFIG,
  created_at: "2026-09-30T00:00:00Z",
  updated_at: "2026-09-30T00:00:00Z",
}));
const JOB_ROW = {
  id: JOB,
  project_id: P,
  type: "report_render",
  state: "running",
  progress: 0.2,
  message: "Snapshots 3 / 12",
  log_path: `runs/${JOB}/job.log`,
  params: { report_id: R, formats: ["pdf"] },
  result: null,
  error: null,
  created_at: "2026-09-30T10:00:00Z",
  started_at: "2026-09-30T10:00:01Z",
  finished_at: null,
};
// R5's ready version, the shape `ReportHistory`'s `View v1` and `ReportPreview`'s version loader
// (`GET …/versions/1/document`, Ruling R-3) both read. R5's versions endpoints are 501 stubs on
// main, so this is mocked directly rather than read from the Prism example.
const VERSION = {
  id: V,
  report_id: R,
  number: 1,
  state: "ready",
  issued_at: null,
  job_id: null,
  folder: `reports/${R}/v001`,
  files: [{ name: "report.pdf", kind: "pdf", bytes: 123456, sha256: "0".repeat(64), pages: 3 }],
  config: CONFIG,
  baseline_version_id: null,
  stats: { finding_count: 38, page_count: 3, part_count: 1, warnings: [], label: null, error: null },
  created_at: "2026-09-30T10:05:00Z",
};
const VERSION_DOCUMENT = {
  report_id: R,
  version: 1,
  generated_at: "2026-09-30T10:05:00Z",
  theme_version: "1",
  sections: SECTIONS.filter((s) => s.enabled).map((s) => ({
    key: s.key,
    title: s.key,
    blocks: [{ kind: "para", text: "Preview text", style: "body" }],
  })),
  next_cursor: null,
};

interface Seen {
  patches: { config?: typeof CONFIG; title?: string }[];
  renders: unknown[];
}

async function answerReports(page: Page): Promise<Seen> {
  const seen: Seen = { patches: [], renders: [] };
  let config = structuredClone(CONFIG);
  const report = () => ({
    id: R,
    title: "Findings summary",
    template_id: "builtin-findings-summary",
    config,
    archived: false,
    created_at: "2026-09-30T09:00:00Z",
    updated_at: "2026-09-30T09:00:00Z",
    last_version: null,
  });
  const base = `/api/v1/projects/${P}/reports`;
  await page.route(
    (u) => u.pathname === "/api/v1/report-templates",
    (r) => r.fulfill(jsonReply({ items: TEMPLATES, next_cursor: null })),
  );
  await page.route(
    (u) => u.pathname === base,
    (r) =>
      r.request().method() === "POST"
        ? r.fulfill(jsonReply(report(), 201))
        : r.fulfill(jsonReply({ items: [], next_cursor: null })),
  );
  await page.route(
    (u) => u.pathname === `${base}/${R}`,
    (r) => {
      if (r.request().method() === "PATCH") {
        const body = r.request().postDataJSON() as Seen["patches"][number];
        seen.patches.push(body);
        if (body.config) config = body.config;
      }
      return r.fulfill(jsonReply(report()));
    },
  );
  await page.route(
    (u) => u.pathname === `${base}/${R}/outline`,
    (r) =>
      r.fulfill(
        jsonReply({
          report_id: R,
          deltas: { baseline: null, new: 0, closed: 0, escalated: 0, deescalated: 0, reopened: 0, left: 0 },
          sections: config.sections
            .filter((s) => s.enabled)
            .map((s) => ({
              key: s.key,
              title: s.key,
              block_count: 1,
              etag: `${s.key}-${seen.patches.length}`,
              estimated_pages: 1,
            })),
          finding_count: 38,
          warnings: [],
        }),
      ),
  );
  await page.route(
    (u) => u.pathname.startsWith(`${base}/${R}/sections/`),
    (r) =>
      r.fulfill(
        jsonReply({ items: [{ kind: "para", text: "Preview text", style: "body" }], next_cursor: null }),
      ),
  );
  await page.route(
    (u) => u.pathname === `${base}/${R}/versions`,
    (r) => r.fulfill(jsonReply({ items: [], next_cursor: null })),
  );
  await page.route(
    (u) => u.pathname === `${base}/${R}/renders`,
    (r) => {
      seen.renders.push(r.request().postDataJSON());
      return r.fulfill(jsonReply({ job: JOB_ROW }, 202));
    },
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/jobs/${JOB}`,
    (r) => r.fulfill(jsonReply(JOB_ROW)),
  );
  return seen;
}

/** Waits for the builder to have finished loading the draft: its 8 sections are on screen. */
async function waitForBuilder(page: Page) {
  await expect(page.getByRole("list", { name: "Sections" }).getByRole("listitem")).toHaveCount(8, {
    timeout: 15_000,
  });
}

test("New report opens the builder; a section toggle saves; Render starts a job shown in History", async ({
  page,
}) => {
  const seen = await answerReports(page);
  await page.goto(`/p/${P}/reports`);
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("No reports yet")).toBeVisible();

  await page.getByRole("button", { name: "New report" }).click();
  const dialog = page.getByRole("dialog", { name: "New report" });
  await dialog.getByRole("radio", { name: /Findings summary/ }).check();
  await dialog.getByRole("button", { name: "Create report" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/reports/${R}$`));

  const sections = page.getByRole("list", { name: "Sections" });
  await expect(sections.getByRole("listitem")).toHaveCount(8);
  await expect(page.getByText("38 findings match")).toBeVisible();

  await page.getByRole("switch", { name: "Appendix" }).click();
  await expect.poll(() => seen.patches.length).toBeGreaterThan(0);
  const saved = seen.patches.at(-1)!.config!.sections.find((s) => s.key === "appendix")!;
  expect(saved.enabled).toBe(false);

  await page.getByRole("button", { name: "Reorder Measurements" }).focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(
    page.getByRole("status").filter({ hasText: "Measurements moved to position 4 of 8" }),
  ).toBeAttached();

  await page.getByRole("button", { name: "Render", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "History" })).toBeVisible();
  await expect(page.getByTestId(`job-${JOB}`)).toBeVisible();
  expect(seen.renders).toEqual([{ formats: ["pdf"] }]);
  const moved = seen.patches.at(-1)!.config!.sections.map((s) => s.key);
  expect(moved.indexOf("measurements")).toBeLessThan(moved.indexOf("finding_pages"));
});

test("the Survey count link opens New report with its template chosen", async ({ page }) => {
  await answerReports(page);
  await page.goto(`/p/${P}/reports?new=builtin-survey-counts`);
  const dialog = page.getByRole("dialog", { name: "New report" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByRole("radio", { name: /Survey count report/ })).toBeChecked();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/reports$`));
});

test("Reports and Data exports switch by address", async ({ page }) => {
  await answerReports(page);
  await page.goto(`/p/${P}/reports`);
  await page.getByRole("radio", { name: "Data exports" }).click({ timeout: 15_000 });
  await expect(page).toHaveURL(new RegExp(`/p/${P}/reports/exports$`));
  await expect(page.getByRole("region", { name: "Data exports" })).toBeVisible();
});

test("R-7.2 Show in preview scrolls the preview pane to that section", async ({ page }) => {
  await answerReports(page);
  await page.goto(`/p/${P}/reports/${R}`);
  await waitForBuilder(page);

  // Appendix is last among the enabled sections, so with six full A4 sheets stacked in the centre
  // pane it starts out below the fold; the button must bring it into view.
  await expect(page.locator('[data-section-key="appendix"]')).not.toBeInViewport();
  await page.getByRole("button", { name: "Show Appendix in preview" }).click();
  await expect(page.locator('[data-section-key="appendix"]')).toBeInViewport();
});

test("Alt+ArrowDown twice moves a section and keeps focus on its control", async ({ page }) => {
  const seen = await answerReports(page);
  await page.goto(`/p/${P}/reports/${R}`);
  await waitForBuilder(page);

  const reorder = page.getByRole("button", { name: "Reorder Executive summary" });
  await reorder.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(reorder).toBeFocused();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(
    page.getByRole("status").filter({ hasText: "Executive summary moved to position 4 of 8" }),
  ).toBeAttached();
  const keys = await page
    .getByRole("list", { name: "Sections" })
    .getByRole("listitem")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-key")));
  expect(keys.slice(0, 4)).toEqual(["cover", "findings_table", "finding_pages", "summary"]);
  await expect(reorder).toBeFocused();
  await expect.poll(() => seen.patches.length).toBeGreaterThan(0);
});

test("History View v1 shows the read-only banner; Back to draft returns to the draft", async ({ page }) => {
  await answerReports(page);
  const base = `/api/v1/projects/${P}/reports`;
  // R5's versions endpoints are 501 stubs on main (R-7.3): mock the list and the version document
  // directly rather than depend on R5's example fixtures.
  await page.route(
    (u) => u.pathname === `${base}/${R}/versions`,
    (r) => r.fulfill(jsonReply({ items: [VERSION], next_cursor: null })),
  );
  await page.route(
    (u) => u.pathname === `${base}/${R}/versions/1/document`,
    (r) => r.fulfill(jsonReply(VERSION_DOCUMENT)),
  );

  await page.goto(`/p/${P}/reports/${R}`);
  await waitForBuilder(page);

  await page.getByRole("button", { name: "History", exact: true }).click();
  const history = page.getByRole("dialog", { name: "History" });
  await expect(history).toBeVisible();
  await history.getByRole("button", { name: "View v1" }).click();

  const banner = page.getByRole("status").filter({ hasText: "Viewing v1 (read only)" });
  await expect(banner).toBeVisible();

  // The History drawer (26rem, z-30) overlaps the preview pane at this viewport width and would
  // intercept the click; closing it first is also what an operator does before going back to the
  // draft (the banner survives closing History — only an edit or Back to draft clears `viewing`).
  await page.getByRole("button", { name: "Close history" }).click();
  await expect(history).toBeHidden();
  await banner.getByRole("button", { name: "Back to draft" }).click();
  await expect(banner).toHaveCount(0);
});
