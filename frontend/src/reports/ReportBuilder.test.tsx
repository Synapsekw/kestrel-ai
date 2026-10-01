import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReportConfig, ReportVersion, ReportWarning } from "@/api/reports";
import {
  errorBody,
  exampleProject,
  fakeClient,
  PROJECT_ID,
  type FakeRoute,
  type RecordedRequest,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import {
  blocks,
  outline,
  RENDER_JOB_ID,
  report,
  REPORT_ID,
  renderJob,
  stats,
  version,
} from "@/test/reportBuilderFixtures";
import { useJobsStore } from "@/store/jobs";
import { useToastStore } from "@/ui";
import { ReportBuilder } from "./ReportBuilder";

// R6's preview is replaced by a stand-in that records what it is given and, like the real one, asks for
// each section's first page when it first sees that section's etag. Its handle records scroll requests.
const seen = vi.hoisted(() => ({
  loaders: new Set<unknown>(),
  outlines: [] as unknown[],
  latest: null as unknown,
  scrolled: [] as string[],
}));
vi.mock("./ReportPreview", async () => {
  const { forwardRef, useEffect, useImperativeHandle, useRef } = await import("react");
  type Props = {
    outline: { sections: { key: string; title: string; etag: string }[] } | null;
    loadBlocks: (k: string, c: string | null) => Promise<unknown>;
    pageCount?: number | null;
  };
  return {
    ReportPreview: forwardRef<{ scrollToSection: (key: string) => void }, Props>(function FakePreview(
      { outline: o, loadBlocks, pageCount },
      ref,
    ) {
      const loaded = useRef(new Map<string, string>());
      seen.loaders.add(loadBlocks);
      seen.latest = loadBlocks;
      useImperativeHandle(
        ref,
        () => ({ scrollToSection: (key: string) => void seen.scrolled.push(key) }),
        [],
      );
      useEffect(() => {
        if (!o) return;
        seen.outlines.push(o);
        for (const s of o.sections) {
          if (loaded.current.get(s.key) === s.etag) continue;
          loaded.current.set(s.key, s.etag);
          void loadBlocks(s.key, null).catch(() => undefined);
        }
      }, [o, loadBlocks]);
      return (
        <section aria-label="Preview" data-pages={pageCount ?? ""}>
          {o?.sections.map((s) => (
            <h3 key={s.key}>{s.title}</h3>
          ))}
        </section>
      );
    }),
  };
});

let current: ReportConfig;
function routes(
  opts: {
    renderStatus?: number;
    patchStatus?: number | (() => number);
    warnings?: ReportWarning[];
    versions?: ReportVersion[];
  } = {},
): FakeRoute[] {
  let outlineCalls = 0;
  let patchStatus = 200;
  return [
    {
      method: "GET",
      path: /\/reports\/[^/]+\/outline$/,
      body: () => {
        outlineCalls += 1;
        return outline(
          outlineCalls > 1 ? { summary: "summary-2" } : {},
          { warnings: opts.warnings ?? [] },
          current,
        );
      },
    },
    { method: "GET", path: /\/sections\/[^/]+\/blocks$/, body: (r) => blocks(r.url) },
    {
      method: "GET",
      path: /\/versions\/\d+\/document/,
      body: {
        report_id: REPORT_ID,
        version: 3,
        generated_at: "2026-09-24T10:00:00Z",
        theme_version: "1",
        sections: [
          { key: "cover", title: "Cover", blocks: [{ kind: "heading", level: 1, text: "v3 cover" }] },
        ],
        next_cursor: null,
      },
    },
    { method: "GET", path: /\/versions$/, body: { items: opts.versions ?? [], next_cursor: null } },
    { method: "DELETE", path: /\/versions\/\d+$/, status: 204 },
    {
      method: "POST",
      path: /\/renders$/,
      status: opts.renderStatus ?? 202,
      body:
        (opts.renderStatus ?? 202) === 202
          ? { job: renderJob() }
          : errorBody("render_running", "A render of this report is already running", {
              job_id: RENDER_JOB_ID,
            }),
    },
    { method: "GET", path: /\/jobs\/[^/]+$/, body: renderJob() },
    {
      method: "PATCH",
      path: /\/reports\/[^/]+$/,
      status: () => {
        const s = opts.patchStatus ?? 200;
        patchStatus = typeof s === "function" ? s() : s;
        return patchStatus;
      },
      body: (r) => {
        if (patchStatus === 500) return errorBody("internal", "The project folder is busy.");
        if (patchStatus !== 200)
          return errorBody("invalid_report", "The report is not valid", {
            errors: [{ path: "config.filters.date.days", message: "must be at least 1" }],
          });
        current = (r.body as { config: ReportConfig }).config;
        return report({ config: current });
      },
    },
    { method: "GET", path: /\/reports\/[^/]+$/, body: () => report({ config: current }) },
    { method: "GET", path: /\/projects\/[^/]+\/data$/, body: { items: [], next_cursor: null } },
    { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  ];
}

function setup(opts: Parameters<typeof routes>[0] = {}) {
  const { api, requests } = fakeClient(routes(opts));
  renderWithProviders(<ReportBuilder projectId={PROJECT_ID} reportId={REPORT_ID} />, { api });
  return requests;
}

const reads = (rq: RecordedRequest[], key: string) =>
  rq.filter((r) => r.method === "GET" && r.url.includes(`/sections/${key}/blocks`)).length;
const index = (rq: RecordedRequest[], pred: (r: RecordedRequest) => boolean) => rq.findIndex(pred);

// Newest first (R5): the draft's page count line uses v4; v3 is the one viewed read-only.
const VERSIONS = [
  version(4, { stats: stats({ finding_count: 38, page_count: 40 }) }),
  version(3, { stats: stats({ finding_count: 5, page_count: 12 }) }),
];

async function viewV3() {
  const requests = setup({ versions: VERSIONS });
  await screen.findByRole("region", { name: "Preview" });
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  fireEvent.click(await screen.findByRole("button", { name: "View v3" }));
  return requests;
}

describe("ReportBuilder", () => {
  beforeEach(() => {
    current = report().config;
    seen.loaders.clear();
    seen.outlines.length = 0;
    seen.latest = null;
    seen.scrolled.length = 0;
    useJobsStore.setState({ jobs: {} });
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("shows the three panes and the top bar", async () => {
    setup();
    expect(await screen.findByRole("list", { name: "Sections" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Report title" })).toHaveValue("Site inspection September");
    expect(await screen.findByRole("region", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Filters" })).toBeInTheDocument();
    expect(await screen.findByText("38 findings match")).toBeInTheDocument();
    for (const name of ["Save as template", "History", "Render", "Render options"])
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All reports" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/reports`,
    );
  });

  it("saves an edit once after 400 ms, re-reads the outline and keeps one blocks loader", async () => {
    const requests = setup();
    await screen.findByRole("region", { name: "Preview" });
    await waitFor(() => expect(reads(requests, "summary")).toBe(1));
    vi.useFakeTimers({ shouldAdvanceTime: false });
    fireEvent.click(screen.getByRole("switch", { name: "Appendix" }));
    await act(() => vi.advanceTimersByTimeAsync(399));
    expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(1));
    vi.useRealTimers();
    await waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(1));
    const body = requests.find((r) => r.method === "PATCH")!.body as { config: ReportConfig };
    expect(body.config.sections.find((s) => s.key === "appendix")?.enabled).toBe(false);
    expect(body.config.sections).toHaveLength(8);
    // The outline is re-read; the preview gets the new etags through the same loader.
    await waitFor(() => expect(reads(requests, "summary")).toBe(2));
    expect(reads(requests, "cover")).toBe(1);
    expect(reads(requests, "findings_table")).toBe(1);
    expect(seen.loaders.size).toBe(1);
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Preview" })).not.toHaveTextContent("Appendix"),
    );
  });

  it("shows the warnings", async () => {
    setup({
      warnings: [{ code: "view3d_missing", message: "12 findings have no 3D view", count: 12, link: null }],
    });
    fireEvent.click(await screen.findByRole("button", { name: "1 warning" }));
    expect(screen.getByRole("dialog", { name: "Report warnings" })).toHaveTextContent(
      "12 findings have no 3D view",
    );
  });

  it("Render starts a report_render job and shows it in History", async () => {
    const requests = setup();
    await screen.findByRole("region", { name: "Preview" });
    fireEvent.click(screen.getByRole("button", { name: "Render" }));
    expect(await screen.findByTestId(`job-${RENDER_JOB_ID}`)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "History" })).toBeInTheDocument();
    expect(requests.find((r) => r.url.endsWith("/renders"))?.body).toEqual({ formats: ["pdf"] });
    expect(useJobsStore.getState().jobs[RENDER_JOB_ID]?.type).toBe("report_render");
  });

  it("renders the formats chosen in Render options", async () => {
    const requests = setup();
    await screen.findByRole("region", { name: "Preview" });
    fireEvent.click(screen.getByRole("button", { name: "Render options" }));
    const menu = screen.getByRole("menu", { name: "Render formats" });
    expect(within(menu).getByRole("menuitemcheckbox", { name: "PDF" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "XLSX" }));
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "CSV" }));
    fireEvent.keyDown(menu, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Render" }));
    await waitFor(() =>
      expect(requests.find((r) => r.url.endsWith("/renders"))?.body).toEqual({
        formats: ["pdf", "xlsx", "csv"],
      }),
    );
  });

  it("a second render opens History on the running job", async () => {
    setup({ renderStatus: 409 });
    await screen.findByRole("region", { name: "Preview" });
    fireEvent.click(screen.getByRole("button", { name: "Render" }));
    expect(await screen.findByTestId(`job-${RENDER_JOB_ID}`)).toBeInTheDocument();
    expect(useToastStore.getState().toasts.at(-1)?.text).toMatch(/already rendering/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a render waits for a waiting edit", async () => {
    const requests = setup();
    await screen.findByRole("region", { name: "Preview" });
    fireEvent.click(screen.getByRole("switch", { name: "Appendix" }));
    fireEvent.click(screen.getByRole("button", { name: "Render" }));
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/renders"))).toBe(true));
    expect(index(requests, (r) => r.method === "PATCH")).toBeLessThan(
      index(requests, (r) => r.url.endsWith("/renders")),
    );
  });

  it("a refused save blocks the render and names the field", async () => {
    const requests = setup({ patchStatus: 422 });
    await screen.findByRole("region", { name: "Preview" });
    fireEvent.click(screen.getByRole("switch", { name: "Appendix" }));
    fireEvent.click(screen.getByRole("button", { name: "Render" }));
    expect(await screen.findByText(/config\.filters\.date\.days: must be at least 1/)).toBeInTheDocument();
    expect(
      await screen.findByText(/was not rendered because its last change was not saved/),
    ).toBeInTheDocument();
    expect(requests.some((r) => r.url.endsWith("/renders"))).toBe(false);
  });

  it("a refused save shows Counting findings… rather than the last saved count", async () => {
    setup({ patchStatus: 422 });
    expect(await screen.findByText("38 findings match")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Appendix" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Not saved/);
    expect(screen.getByText("Counting findings…")).toBeInTheDocument();
    expect(screen.queryByText("38 findings match")).toBeNull();
  });

  it("a save that failed for another reason is retried by Render, which then goes ahead", async () => {
    let calls = 0;
    const requests = setup({ patchStatus: () => (++calls === 1 ? 500 : 200) });
    await screen.findByRole("region", { name: "Preview" });
    fireEvent.click(screen.getByRole("switch", { name: "Appendix" }));
    expect(await screen.findByText(/Not saved: The project folder is busy\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Render" }));
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/renders"))).toBe(true));
    expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(2);
    expect(screen.queryByText(/was not rendered/)).toBeNull();
  });

  it("a save that keeps failing for another reason says so and asks to render again", async () => {
    const requests = setup({ patchStatus: 500 });
    await screen.findByRole("region", { name: "Preview" });
    fireEvent.click(screen.getByRole("switch", { name: "Appendix" }));
    await screen.findByText(/Not saved/);
    fireEvent.click(screen.getByRole("button", { name: "Render" }));
    expect(
      await screen.findByText("The report could not be saved: The project folder is busy. Try Render again."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Fix the setting named above/)).toBeNull();
    expect(requests.some((r) => r.url.endsWith("/renders"))).toBe(false);
  });

  it("a render that does not start says why without a doubled full stop", async () => {
    const { api } = fakeClient(
      routes().map((r) =>
        r.method === "POST"
          ? { ...r, status: 500, body: errorBody("internal", "The renderer is missing.") }
          : r,
      ),
    );
    renderWithProviders(<ReportBuilder projectId={PROJECT_ID} reportId={REPORT_ID} />, { api });
    await screen.findByRole("region", { name: "Preview" });
    fireEvent.click(screen.getByRole("button", { name: "Render" }));
    expect(await screen.findByText("The renderer is missing. Try Render again.")).toBeInTheDocument();
  });

  it("the save status is announced and the title is bounded", async () => {
    setup();
    await screen.findByRole("region", { name: "Preview" });
    expect(screen.getByRole("textbox", { name: "Report title" })).toHaveAttribute("maxLength", "200");
    fireEvent.click(screen.getByRole("switch", { name: "Appendix" }));
    expect(screen.getByText("Saving…")).toHaveAttribute("role", "status");
    await waitFor(() => expect(screen.getByText("Saved")).toHaveAttribute("role", "status"));
  });

  it("History toggles the drawer", async () => {
    setup();
    await screen.findByRole("region", { name: "Preview" });
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByRole("dialog", { name: "History" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.queryByRole("dialog", { name: "History" })).toBeNull();
  });

  it("Save as template opens with the report's title", async () => {
    setup();
    await screen.findByRole("region", { name: "Preview" });
    fireEvent.click(screen.getByRole("button", { name: "Save as template" }));
    expect(
      within(screen.getByRole("dialog", { name: "Save as template" })).getByLabelText("Name"),
    ).toHaveValue("Site inspection September");
  });

  it("a report that cannot be opened says so", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/reports\/[^/]+\/outline$/, status: 404, body: errorBody("not_found", "x") },
      { method: "GET", path: /\/versions$/, body: { items: [], next_cursor: null } },
      {
        method: "GET",
        path: /\/reports\/[^/]+$/,
        status: 404,
        body: errorBody("not_found", "This report does not exist"),
      },
    ]);
    renderWithProviders(<ReportBuilder projectId={PROJECT_ID} reportId={REPORT_ID} />, { api });
    expect(await screen.findByText("This report does not exist")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All reports" })).toBeInTheDocument();
  });

  // R-7.2: a section row's Show button scrolls the preview to that section.
  it("Show <section> in preview scrolls the preview to it", async () => {
    setup();
    await screen.findByRole("region", { name: "Preview" });
    fireEvent.click(await screen.findByRole("button", { name: "Show Findings table in preview" }));
    expect(seen.scrolled).toEqual(["findings_table"]);
  });

  // R-7.3: a version is previewed read-only from History; any edit returns to the draft.
  it("View v<n> shows the version read-only and requests its document", async () => {
    const requests = await viewV3();
    const banner = await screen.findByText("Viewing v3 (read only)");
    expect(banner.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "View v3" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(requests.some((r) => r.url.includes("/versions/3/document"))).toBe(true));
    expect(screen.getByRole("region", { name: "Preview" })).toHaveAttribute("data-pages", "12");
    expect(seen.loaders.size).toBe(2);
    // Pressing the shown version again returns to the draft.
    fireEvent.click(screen.getByRole("button", { name: "View v3" }));
    expect(screen.queryByText("Viewing v3 (read only)")).toBeNull();
  });

  it("Back to draft restores the draft preview", async () => {
    await viewV3();
    const draftLoader = [...seen.loaders][0];
    fireEvent.click(await screen.findByRole("button", { name: "Back to draft" }));
    expect(screen.queryByText("Viewing v3 (read only)")).toBeNull();
    expect(screen.getByRole("region", { name: "Preview" })).toHaveAttribute("data-pages", "40");
    expect(seen.latest).toBe(draftLoader);
    expect(screen.getByRole("button", { name: "View v3" })).toHaveAttribute("aria-pressed", "false");
  });

  it("Back to draft moves focus to the History View button while History is open", async () => {
    await viewV3();
    fireEvent.click(await screen.findByRole("button", { name: "Back to draft" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "View v3" })).toHaveFocus());
  });

  it("Back to draft with History closed moves focus to the preview pane", async () => {
    await viewV3();
    fireEvent.click(screen.getByRole("button", { name: "Close history" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back to draft" }));
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement).toContainElement(screen.getByRole("region", { name: "Preview" }));
  });

  it("deleting the version being viewed returns the preview to the draft", async () => {
    const requests = await viewV3();
    await screen.findByText("Viewing v3 (read only)");
    const rows = within(screen.getByRole("dialog", { name: "History" })).getAllByRole("button", {
      name: "Delete version",
    });
    fireEvent.click(rows[1]); // v3 is the second row (newest first)
    const confirm = await screen.findByRole("dialog", { name: "Delete v3?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete version" }));
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.queryByText("Viewing v3 (read only)")).toBeNull());
    expect(screen.getByRole("region", { name: "Preview" })).toHaveAttribute("data-pages", "40");
  });

  it("an edit while viewing a version returns the preview to the draft", async () => {
    await viewV3();
    await screen.findByText("Viewing v3 (read only)");
    fireEvent.click(screen.getByRole("switch", { name: "Appendix" }));
    expect(screen.queryByText("Viewing v3 (read only)")).toBeNull();
    expect(screen.getByRole("region", { name: "Preview" })).toHaveAttribute("data-pages", "40");
    fireEvent.click(screen.getByRole("button", { name: "View v3" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Report title" }), { target: { value: "Renamed" } });
    expect(screen.queryByText("Viewing v3 (read only)")).toBeNull();
  });
});
