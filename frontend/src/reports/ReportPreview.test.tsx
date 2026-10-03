import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadBlocks, ReportOutline } from "@/api/reports";
import { fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { installFakeIntersectionObserver, type FakeIntersection } from "./preview/fakeIntersectionObserver";
import { FIXTURE_BLOCKS, FIXTURE_OUTLINE, fixtureLoader } from "./preview/fixtures";
import { FIGURE_MARGIN } from "./preview/SnapshotImage";
import {
  ReportPreview,
  SECTION_MARGIN,
  type ReportPreviewHandle,
  type ReportPreviewProps,
} from "./ReportPreview";

let io: FakeIntersection;
beforeEach(() => {
  io = installFakeIntersectionObserver();
});
afterEach(() => io.restore());

const section = (key: string) => (el: Element) => el.getAttribute("data-section-key") === key;
const tail = (key: string) => (el: Element) => el.getAttribute("data-testid") === `pending-${key}`;

function setup(props: Partial<ReportPreviewProps> = {}) {
  const loadBlocks = vi.fn<LoadBlocks>(fixtureLoader());
  const ref = createRef<ReportPreviewHandle>();
  const all: ReportPreviewProps = {
    projectId: "p1",
    outline: FIXTURE_OUTLINE,
    loadBlocks,
    resolveSnapshot: (r) => `snap://${r.key}`,
    ...props,
  };
  const utils = render(<ReportPreview ref={ref} {...all} />);
  return { ...utils, loadBlocks: all.loadBlocks as typeof loadBlocks, ref, props: all };
}

describe("ReportPreview", () => {
  it("is a region named Preview with one titled region per section", () => {
    setup();
    const preview = screen.getByRole("region", { name: "Preview" });
    for (const s of FIXTURE_OUTLINE.sections) {
      const region = within(preview).getByRole("region", { name: s.title });
      expect(within(region).getByRole("heading", { level: 3, name: s.title })).toBeInTheDocument();
    }
  });

  it("loads a section only when it comes near the viewport", async () => {
    const { loadBlocks } = setup();
    expect(loadBlocks).not.toHaveBeenCalled();
    act(() => io.show(section("summary")));
    await screen.findByText("Findings at a glance");
    expect(loadBlocks).toHaveBeenCalledTimes(1);
    expect(loadBlocks).toHaveBeenCalledWith("summary", null);
    expect(loadBlocks.mock.calls.some(([k]) => k === "appendix")).toBe(false);
  });

  it("pages through a section while its tail stays near, then stops", async () => {
    const loadBlocks = vi.fn<LoadBlocks>(fixtureLoader(FIXTURE_BLOCKS, 2));
    setup({ loadBlocks });
    act(() => io.show(section("summary")));
    await screen.findByText("Findings at a glance");
    act(() => io.show(tail("summary")));
    await waitFor(() => expect(screen.queryByTestId("pending-summary")).toBeNull());
    expect(loadBlocks.mock.calls.map(([, c]) => c)).toEqual([null, "2", "4"]);
  });

  it("refetches only a section whose etag changed, keeping its old blocks meanwhile", async () => {
    const { loadBlocks, rerender, props } = setup();
    act(() => io.show((el) => section("summary")(el) || section("findings_table")(el)));
    await screen.findByText("Findings at a glance");
    await screen.findByRole("columnheader", { name: "Type" });
    loadBlocks.mockClear();
    let release: () => void = () => {};
    loadBlocks.mockImplementationOnce(
      (key, cursor) => new Promise((ok) => (release = () => ok(fixtureLoader()(key, cursor)))),
    );
    const edited: ReportOutline = {
      ...FIXTURE_OUTLINE,
      sections: FIXTURE_OUTLINE.sections.map((s) =>
        s.key === "summary" ? { ...s, etag: "e-summary-2" } : s,
      ),
    };
    rerender(<ReportPreview {...props} outline={edited} />);
    await waitFor(() => expect(loadBlocks).toHaveBeenCalledWith("summary", null));
    expect(screen.getByText("Findings at a glance")).toBeInTheDocument(); // stale, dimmed
    expect(screen.getByRole("region", { name: "Summary" })).toHaveAttribute("aria-busy", "true");
    await act(async () => release());
    expect(screen.getByRole("region", { name: "Summary" })).toHaveAttribute("aria-busy", "false");
    expect(loadBlocks.mock.calls.every(([k]) => k === "summary")).toBe(true);
    expect(screen.getByRole("columnheader", { name: "Type" })).toBeInTheDocument();
  });

  it("drops the old blocks when a section is edited down to nothing, without a request", async () => {
    const { loadBlocks, rerender, props } = setup();
    act(() => io.show(section("summary")));
    await screen.findByText("Findings at a glance");
    loadBlocks.mockClear();
    const emptied: ReportOutline = {
      ...FIXTURE_OUTLINE,
      sections: FIXTURE_OUTLINE.sections.map((s) =>
        s.key === "summary" ? { ...s, etag: "e-summary-empty", block_count: 0 } : s,
      ),
    };
    rerender(<ReportPreview {...props} outline={emptied} />);
    const region = screen.getByRole("region", { name: "Summary" });
    expect(within(region).getByText("Nothing to show in this section.")).toBeInTheDocument();
    expect(within(region).queryByText("Findings at a glance")).toBeNull();
    expect(region).toHaveAttribute("aria-busy", "false");
    expect(loadBlocks).not.toHaveBeenCalled();
  });

  it("is not busy when a changed section's refetch fails; it keeps the old blocks and offers Retry", async () => {
    const { loadBlocks, rerender, props } = setup();
    act(() => io.show(section("summary")));
    await screen.findByText("Findings at a glance");
    loadBlocks.mockRejectedValueOnce(new Error("disk"));
    const edited: ReportOutline = {
      ...FIXTURE_OUTLINE,
      sections: FIXTURE_OUTLINE.sections.map((s) =>
        s.key === "summary" ? { ...s, etag: "e-summary-2" } : s,
      ),
    };
    rerender(<ReportPreview {...props} outline={edited} />);
    const region = screen.getByRole("region", { name: "Summary" });
    await within(region).findByText("Could not load this section.");
    expect(region).toHaveAttribute("aria-busy", "false");
    expect(within(region).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(within(region).getByText("Findings at a glance")).toBeInTheDocument();
  });

  it("roots the section and figure observers at the preview, with their margins", async () => {
    const { container } = setup();
    const preview = screen.getByRole("region", { name: "Preview" });
    const summary = container.querySelector('[data-section-key="summary"]')!;
    // Compare the root by identity: a failing toMatchObject would pretty-print the whole DOM tree.
    const sectionInit = io.initOf(summary);
    expect(sectionInit?.root === preview).toBe(true);
    expect(sectionInit?.rootMargin).toBe(SECTION_MARGIN);
    expect(SECTION_MARGIN).toBe("1200px 0px");
    act(() => io.show(section("finding_pages")));
    await screen.findByRole("article", { name: "F-0042 Crack" });
    const figure = container.querySelector('[data-snapshot="s-main"]')!;
    const figureInit = io.initOf(figure);
    expect(figureInit?.root === preview).toBe(true);
    expect(figureInit?.rootMargin).toBe(FIGURE_MARGIN);
    expect(FIGURE_MARGIN).toBe("600px 0px");
  });

  it("offers Retry when a section fails, and loads on retry", async () => {
    const good = fixtureLoader();
    const loadBlocks = vi.fn<LoadBlocks>().mockRejectedValueOnce(new Error("disk")).mockImplementation(good);
    setup({ loadBlocks });
    act(() => io.show(section("summary")));
    const region = screen.getByRole("region", { name: "Summary" });
    await within(region).findByText("Could not load this section.");
    fireEvent.click(within(region).getByRole("button", { name: "Retry" }));
    await within(region).findByText("Findings at a glance");
  });

  it("gives each finding its own sheet and splits at page breaks", async () => {
    const { container } = setup();
    act(() => io.show((el) => section("finding_pages")(el) || section("appendix")(el)));
    await screen.findByRole("article", { name: "F-0042 Crack" });
    await screen.findByText("Model provenance: yolo11s (0.87).");
    const pages = container.querySelector('[data-section-key="finding_pages"]')!;
    expect(pages.querySelectorAll('[data-sheet="finding"]')).toHaveLength(2);
    const appendix = container.querySelector('[data-section-key="appendix"]')!;
    expect(appendix.querySelectorAll('[data-sheet="flow"]')).toHaveLength(2);
  });

  it("paints the cover band and puts the title on it in white", async () => {
    const { container } = setup();
    act(() => io.show(section("cover")));
    await screen.findByText("North yard inspection");
    const band = container.querySelector("[data-cover-band]") as HTMLElement;
    expect(band).toHaveTextContent("North yard inspection");
    expect(band.style.background).toContain("linear-gradient");
    expect(screen.getByRole("cell", { name: "Acme Build" })).toBeInTheDocument();
  });

  it("puts the logo from the given asset resolver on the cover sheet", async () => {
    const { container } = setup({ resolveAsset: (id) => `asset://${id}` });
    act(() => io.show(section("cover")));
    await screen.findByText("North yard inspection");
    const cover = container.querySelector('[data-sheet="cover"]') as HTMLElement;
    expect(within(cover).getByRole("img", { name: "Logo" })).toHaveAttribute("src", "asset://logo1");
  });

  it("draws the cover in the brand it is given", async () => {
    const { container } = setup({
      brand: { gradient: ["#141D2D", "#141D2D", "#9E0000"], fontFamily: null, logoSrc: null },
    });
    act(() => io.show(section("cover")));
    await screen.findByText("North yard inspection");
    const band = container.querySelector("[data-cover-band]") as HTMLElement;
    expect(band.style.background).toContain("rgb(158, 0, 0)");
  });

  it("requests a figure only when it is near, through the given resolver", async () => {
    setup();
    act(() => io.show(section("finding_pages")));
    await screen.findByRole("article", { name: "F-0042 Crack" });
    expect(screen.queryByRole("img", { name: "Image crop" })).toBeNull();
    act(() => io.show((el) => el.getAttribute("data-snapshot") === "s-main"));
    expect(screen.getByRole("img", { name: "Image crop" })).toHaveAttribute("src", "snap://s-main");
  });

  it("defaults to the backend snapshot URL", async () => {
    const { api } = fakeClient([]);
    render(
      <TestApiProvider api={api}>
        <ReportPreview projectId="p1" outline={FIXTURE_OUTLINE} loadBlocks={fixtureLoader()} />
      </TestApiProvider>,
    );
    act(() => io.show(section("finding_pages")));
    await screen.findByRole("article", { name: "F-0042 Crack" });
    act(() => io.show((el) => el.getAttribute("data-snapshot") === "s-main"));
    expect(screen.getByRole("img", { name: "Image crop" }).getAttribute("src")).toMatch(
      /^http:\/\/fake\/api\/v1\/projects\/p1\/report-snapshots\/s-main\?spec=[A-Za-z0-9_-]+&token=t$/,
    );
  });

  it("shows the last render's page count and the outline's estimate", () => {
    const { rerender, props } = setup({ pageCount: 12 });
    expect(screen.getByText("12 pages at the last render · about 8 pages now")).toBeInTheDocument();
    rerender(<ReportPreview {...props} pageCount={null} />);
    expect(screen.getByText("Not rendered yet · about 8 pages now")).toBeInTheDocument();
  });

  it("scrolls to a section on request", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { ref } = setup();
    act(() => ref.current?.scrollToSection("appendix"));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(document.querySelector('[data-section-key="appendix"]'));
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("shows a loading sheet without an outline and an empty state without sections", () => {
    const { rerender, props } = setup({ outline: null });
    expect(screen.getByRole("status", { name: "Loading section" })).toBeInTheDocument();
    rerender(<ReportPreview {...props} outline={{ ...FIXTURE_OUTLINE, sections: [] }} />);
    expect(screen.getByText("No sections enabled")).toBeInTheDocument();
  });

  it("sizes the sheets for the paper", () => {
    setup({ paper: "Letter" });
    const column = screen.getByTestId("preview-column");
    expect(column.style.getPropertyValue("--mm")).toBe("min(calc(100cqw / 215.9), 1mm)");
  });
});
