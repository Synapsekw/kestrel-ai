import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReportVersion } from "@/api/reports";
import { errorBody, fakeClient, PROJECT_ID, type FakeRoute, type RecordedRequest } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { RENDER_JOB_ID, REPORT_ID, renderJob, stats, version } from "@/test/reportBuilderFixtures";
import { useJobsStore } from "@/store/jobs";
import { ReportHistory } from "./ReportHistory";
import { useVersionHistory, type VersionHistory } from "./useVersionHistory";

const ISSUED = version(3, { issued_at: "2026-09-24T12:00:00Z" });
const DRAFT = version(2);
const FAILED = version(9, {
  id: "vfailed",
  number: null,
  state: "failed",
  folder: null,
  files: [],
  stats: stats({ error: "The disk is full" }),
});
const RENDERING = version(0, {
  id: "vrun0",
  number: null,
  state: "rendering",
  folder: null,
  files: [],
  job_id: RENDER_JOB_ID,
  stats: stats(),
});

let hook: VersionHistory | null = null;
interface HostProps {
  onClose: () => void;
  onView?: (v: ReportVersion) => void;
  viewing?: number | null;
}
function Host({ onClose, onView, viewing }: HostProps) {
  const versions = useVersionHistory(PROJECT_ID, REPORT_ID);
  useEffect(() => {
    hook = versions;
  });
  return (
    <ReportHistory
      projectId={PROJECT_ID}
      versions={versions}
      open
      onClose={onClose}
      onView={onView}
      viewing={viewing}
    />
  );
}

/** The versions route keeps its own state, so a reload after issue or delete reads the change. */
function setup(
  initial: ReportVersion[] = [ISSUED, DRAFT, FAILED],
  extra: FakeRoute[] = [],
  hostProps: Omit<HostProps, "onClose"> = {},
) {
  let items = [...initial];
  const onClose = vi.fn();
  const { api, requests } = fakeClient([
    ...extra,
    { method: "GET", path: /\/versions$/, body: () => ({ items, next_cursor: null }) },
    {
      method: "PATCH",
      path: /\/versions\/\d+$/,
      body: (r) => {
        const n = Number(r.url.split("/").pop());
        const issued = (r.body as { issued: boolean }).issued;
        items = items.map((v) =>
          v.number === n ? { ...v, issued_at: issued ? "2026-09-30T08:00:00Z" : null } : v,
        );
        return items.find((v) => v.number === n)!;
      },
    },
    {
      method: "DELETE",
      path: /\/versions\/\d+$/,
      status: (r) => {
        const n = Number(r.url.split("/").pop());
        items = items.filter((v) => v.number !== n);
        return 204;
      },
    },
    { method: "POST", path: /\/open$/, status: 204 },
    { method: "GET", path: /\/jobs\/[^/]+$/, body: renderJob() },
  ]);
  renderWithProviders(<Host onClose={onClose} {...hostProps} />, { api });
  return { onClose, requests };
}

const row = (name: RegExp) =>
  within(screen.getByRole("dialog", { name: "History" }))
    .getAllByRole("listitem")
    .find((li) => name.test(li.textContent ?? ""))!;
const versionReads = (rq: RecordedRequest[]) =>
  rq.filter((r) => r.method === "GET" && /\/versions\?/.test(r.url));

describe("ReportHistory", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {} });
    hook = null;
  });

  it("lists versions with state, pages, parts and files", async () => {
    setup();
    await screen.findByText("ahmadia-site-inspection-v003.pdf");
    const v3 = row(/^v3/);
    expect(within(v3).getByText("Issued 24 Sep")).toBeInTheDocument();
    expect(within(v3).getByText("38 pages")).toBeInTheDocument();
    expect(within(v3).getByText("findings.csv")).toBeInTheDocument();
    expect(within(row(/Render failed/)).getByText("The disk is full")).toBeInTheDocument();
    expect(within(row(/Render failed/)).queryByRole("button")).toBeNull();
  });

  it("marks a draft as issued and unissues it", async () => {
    const { requests } = setup();
    await screen.findByText("ahmadia-site-inspection-v002.pdf");
    fireEvent.click(within(row(/^v2/)).getByRole("button", { name: "Mark as issued" }));
    await waitFor(() => expect(within(row(/^v2/)).getByText("Issued 30 Sep")).toBeInTheDocument());
    const patch = requests.find((r) => r.method === "PATCH")!;
    expect(patch.url).toMatch(/\/versions\/2$/);
    expect(patch.body).toEqual({ issued: true });
    fireEvent.click(within(row(/^v2/)).getByRole("button", { name: "Unissue" }));
    await waitFor(() =>
      expect(within(row(/^v2/)).getByRole("button", { name: "Mark as issued" })).toBeInTheDocument(),
    );
    expect(requests.filter((r) => r.method === "PATCH").at(-1)!.body).toEqual({ issued: false });
  });

  it("an issued version cannot be deleted", async () => {
    setup();
    await screen.findByText("ahmadia-site-inspection-v003.pdf");
    expect(within(row(/^v3/)).queryByRole("button", { name: "Delete version" })).toBeNull();
  });

  it("deletes a draft after confirming and re-reads the list", async () => {
    const { requests } = setup();
    await screen.findByText("ahmadia-site-inspection-v002.pdf");
    fireEvent.click(within(row(/^v2/)).getByRole("button", { name: "Delete version" }));
    const confirm = screen.getByRole("dialog", { name: "Delete v2?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete version" }));
    await waitFor(() => expect(screen.queryByText("ahmadia-site-inspection-v002.pdf")).toBeNull());
    expect(requests.some((r) => r.method === "DELETE" && /\/versions\/2$/.test(r.url))).toBe(true);
    expect(versionReads(requests).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("dialog", { name: "Delete v2?" })).toBeNull();
  });

  it("a refused delete explains why", async () => {
    setup(undefined, [
      {
        method: "DELETE",
        path: /\/versions\/\d+$/,
        status: 409,
        body: errorBody("issued_version", "v2 was issued, so it is kept"),
      },
    ]);
    await screen.findByText("ahmadia-site-inspection-v002.pdf");
    fireEvent.click(within(row(/^v2/)).getByRole("button", { name: "Delete version" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Delete v2?" })).getByRole("button", {
        name: "Delete version",
      }),
    );
    expect(await screen.findByText(/was issued, so it is kept\. Unissue it first/)).toBeInTheDocument();
  });

  it("opens the PDF with the default application", async () => {
    const { requests } = setup();
    await screen.findByText("ahmadia-site-inspection-v003.pdf");
    fireEvent.click(within(row(/^v3/)).getByRole("button", { name: "Open PDF" }));
    await waitFor(() =>
      expect(requests.find((r) => r.url.endsWith("/open"))?.body).toEqual({
        path: `reports/${REPORT_ID}/v003/ahmadia-site-inspection-v003.pdf`,
      }),
    );
  });

  it("names the parts of a split PDF", async () => {
    const parts = version(4, {
      files: [
        { name: "a-v004-part1-of-2.pdf", kind: "pdf", bytes: 1, sha256: "d".repeat(64), pages: 200 },
        { name: "a-v004-part2-of-2.pdf", kind: "pdf", bytes: 1, sha256: "e".repeat(64), pages: 130 },
      ],
      stats: stats({ page_count: 330, part_count: 2 }),
    });
    setup([parts]);
    await screen.findByText("a-v004-part1-of-2.pdf");
    expect(within(row(/^v4/)).getByText("330 pages · 2 parts")).toBeInTheDocument();
    expect(within(row(/^v4/)).getByRole("button", { name: "Open part 2" })).toBeInTheDocument();
  });

  it("reads the job of a version still rendering and shows it as a job card", async () => {
    setup([
      version(0, {
        id: "vrun",
        number: null,
        state: "rendering",
        folder: null,
        files: [],
        job_id: RENDER_JOB_ID,
        stats: stats(),
      }),
    ]);
    expect(await screen.findByTestId(`job-${RENDER_JOB_ID}`)).toBeInTheDocument();
    expect(row(/Rendering…/)).toBeInTheDocument();
  });

  it("follows a tracked render until it finishes", async () => {
    setup([]);
    await screen.findByText(/No versions yet/);
    act(() => {
      useJobsStore.getState().upsert(renderJob());
      hook!.track(RENDER_JOB_ID);
    });
    expect(await screen.findByTestId(`job-${RENDER_JOB_ID}`)).toBeInTheDocument();
    act(() => useJobsStore.getState().upsert(renderJob({ state: "succeeded", progress: 1 })));
    await waitFor(() => expect(screen.queryByTestId(`job-${RENDER_JOB_ID}`)).toBeNull());
  });

  it("closes on Escape", async () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "History" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  // R-7.3 (recon 10 overrides plan Ruling 6): the `View v<n>` toggle, wired to onView/viewing.

  it("has no View button when onView is absent (R-7.3)", async () => {
    setup();
    await screen.findByText("ahmadia-site-inspection-v003.pdf");
    expect(within(row(/^v3/)).queryByRole("button", { name: "View v3" })).toBeNull();
  });

  it("calls onView with the version when its View button is clicked (R-7.3)", async () => {
    const onView = vi.fn();
    setup(undefined, [], { onView });
    await screen.findByText("ahmadia-site-inspection-v003.pdf");
    fireEvent.click(within(row(/^v3/)).getByRole("button", { name: "View v3" }));
    expect(onView).toHaveBeenCalledWith(ISSUED);
  });

  it("marks the currently viewed version's button pressed (R-7.3)", async () => {
    setup(undefined, [], { onView: vi.fn(), viewing: 3 });
    await screen.findByText("ahmadia-site-inspection-v003.pdf");
    expect(within(row(/^v3/)).getByRole("button", { name: "View v3" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(row(/^v2/)).getByRole("button", { name: "View v2" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("has no View button on a rendering or failed row (R-7.3)", async () => {
    setup([ISSUED, DRAFT, FAILED, RENDERING], [], { onView: vi.fn() });
    await screen.findByText("ahmadia-site-inspection-v003.pdf");
    expect(within(row(/Render failed/)).queryByRole("button", { name: /^View v/ })).toBeNull();
    expect(within(row(/Rendering…/)).queryByRole("button", { name: /^View v/ })).toBeNull();
  });
});
