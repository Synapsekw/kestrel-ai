import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockOf } from "@/api/reports";
import { ALL_BLOCK_KINDS, FIXTURE_BLOCKS } from "../fixtures";
import { installFakeIntersectionObserver, type FakeIntersection } from "../fakeIntersectionObserver";
import { PreviewEnvContext } from "../PreviewContext";
import { BlockView } from "./BlockView";
import { CoverBlock } from "./CoverBlock";
import { FindingBlock } from "./FindingBlock";
import { VolumeBlock } from "./VolumeBlock";

let io: FakeIntersection;
beforeEach(() => {
  io = installFakeIntersectionObserver();
});
afterEach(() => io.restore());

// A working resolveSnapshot so figures render real <img> elements instead of the "no backend" reason
// (figureBlocks.test.tsx's own `env` pattern).
const resolve = vi.fn((ref: { key: string }) => `snap://${ref.key}`);
const withSnapshots = ({ children }: { children: ReactNode }) => (
  <PreviewEnvContext.Provider
    value={{ resolveSnapshot: resolve, resolveAsset: () => null, scrollRoot: null, paper: "A4" }}
  >
    {children}
  </PreviewEnvContext.Provider>
);

const everyBlock: Block[] = Object.values(FIXTURE_BLOCKS).flat();
const findings = FIXTURE_BLOCKS.finding_pages as BlockOf<"finding">[];
const volumes = FIXTURE_BLOCKS.measurements.filter((b): b is BlockOf<"volume"> => b.kind === "volume");
const cover = FIXTURE_BLOCKS.cover[0] as BlockOf<"cover">;

describe("every block kind renders from the fixture outline (spec §17)", () => {
  it("covers every kind the contract defines", () => {
    expect(new Set(everyBlock.map((b) => b.kind))).toEqual(new Set(Object.keys(ALL_BLOCK_KINDS)));
  });

  it.each(everyBlock.map((b, i) => [`${i}:${b.kind}`, b] as const))("renders %s", (_, block) => {
    const { container } = render(<BlockView block={block} />);
    expect(container.querySelector(`[data-block="${block.kind}"]`)).not.toBeNull();
  });
});

describe("FindingBlock", () => {
  it("prints the head as number, type, severity word and status, then figures, kv, note, photos and comments", () => {
    render(<FindingBlock block={findings[0]} />, { wrapper: withSnapshots });
    const page = screen.getByRole("article", { name: "F-0042 Crack" });
    expect(within(page).getByText("F-0042")).toHaveClass("font-mono");
    expect(within(page).getByText("Major")).toBeInTheDocument();
    expect(within(page).getByText("Open")).toBeInTheDocument();
    expect(within(page).getByRole("rowheader", { name: "Observed" })).toBeInTheDocument();
    expect(within(page).getByText("Hairline crack along the joint.")).toBeInTheDocument();
    expect(within(page).getByText("Checked on site.")).toBeInTheDocument();
    expect(within(page).getByText("D. Jovanovic · 2026-09-24")).toBeInTheDocument();
    act(() => io.show(() => true));
    expect(
      within(page)
        .getAllByRole("img", { name: /^Photo/ })
        .map((i) => i.getAttribute("alt")),
    ).toEqual(["Photo 1", "Photo 2: North face"]);
    expect(within(page).getByRole("img", { name: "Image crop" })).toBeInTheDocument();
  });

  it("prints Ungraded for a finding without a severity, and the reason for a missing snapshot", () => {
    render(<FindingBlock block={findings[1]} />);
    const page = screen.getByRole("article", { name: "F-0043 Spall" });
    expect(within(page).getByText("Ungraded")).toBeInTheDocument();
    expect(within(page).getByText("Reviewed")).toBeInTheDocument();
    expect(
      within(page).getByRole("img", { name: "Image crop: The source image was moved" }),
    ).toBeInTheDocument();
    expect(within(page).queryByText("Photos")).toBeNull();
    expect(within(page).queryByText("Comments")).toBeNull();
  });
});

describe("VolumeBlock", () => {
  it("prints the rows of a fresh volume and 'Stale, recalculate' instead of numbers", () => {
    render(<VolumeBlock block={volumes[0]} />);
    render(<VolumeBlock block={volumes[1]} />);
    expect(screen.getByRole("cell", { name: "894.3 m³" })).toBeInTheDocument();
    const stale = screen.getByRole("group", { name: "Stockpile B" });
    expect(within(stale).getByText("Stale, recalculate")).toBeInTheDocument();
    expect(within(stale).queryByRole("table")).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("labels each volume by its own title even when the same measurement is shown twice", () => {
    render(<VolumeBlock block={volumes[1]} />);
    render(<VolumeBlock block={volumes[1]} />);
    const groups = screen.getAllByRole("group", { name: "Stockpile B" });
    expect(groups).toHaveLength(2);
    expect(groups[0].getAttribute("aria-labelledby")).not.toBe(groups[1].getAttribute("aria-labelledby"));
  });
});

describe("CoverBlock (Ruling R-6)", () => {
  it("paints the full-bleed band with the title, subtitle and a linear-gradient background", () => {
    const { container } = render(<CoverBlock block={cover} />);
    const band = container.querySelector("[data-cover-band]");
    expect(band).not.toBeNull();
    expect(within(band as HTMLElement).getByText("North yard inspection")).toBeInTheDocument();
    expect(within(band as HTMLElement).getByText("Monthly condition survey")).toBeInTheDocument();
    expect((band as HTMLElement).style.background).toMatch(/^linear-gradient\(135deg/);
  });

  it("prints the rows as a table and reveals the locator once it is near the viewport", () => {
    render(<CoverBlock block={cover} />, { wrapper: withSnapshots });
    expect(screen.getByRole("cell", { name: "Acme Build" })).toBeInTheDocument();
    expect(screen.getByTestId("snapshot-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Site locator" })).toBeNull();
    act(() => io.show(() => true));
    expect(screen.getByRole("img", { name: "Site locator" })).toBeInTheDocument();
  });

  it("shows the logo in a chip when resolveAsset resolves it", () => {
    const withLogo = ({ children }: { children: ReactNode }) => (
      <PreviewEnvContext.Provider
        value={{
          resolveSnapshot: () => null,
          resolveAsset: (id) => (id === "logo1" ? "asset://logo1" : null),
          scrollRoot: null,
          paper: "A4",
        }}
      >
        {children}
      </PreviewEnvContext.Provider>
    );
    render(<CoverBlock block={cover} />, { wrapper: withLogo });
    expect(screen.getByRole("img", { name: "Logo" })).toHaveAttribute("src", "asset://logo1");
  });

  it("hides the logo chip when the logo image fails to load", () => {
    const withLogo = ({ children }: { children: ReactNode }) => (
      <PreviewEnvContext.Provider
        value={{
          resolveSnapshot: () => null,
          resolveAsset: () => "asset://gone",
          scrollRoot: null,
          paper: "A4",
        }}
      >
        {children}
      </PreviewEnvContext.Provider>
    );
    const { container } = render(<CoverBlock block={cover} />, { wrapper: withLogo });
    fireEvent.error(screen.getByRole("img", { name: "Logo" }));
    expect(screen.queryByRole("img", { name: "Logo" })).toBeNull();
    expect(container.querySelector("[data-logo-chip]")).toBeNull();
  });

  it("renders no chip (no broken image) when resolveAsset returns null", () => {
    render(<CoverBlock block={cover} />); // default context: resolveAsset returns null
    expect(screen.queryByRole("img", { name: "Logo" })).toBeNull();
  });

  it("renders no chip when the block has no logo, even if resolveAsset would resolve one", () => {
    const withLogo = ({ children }: { children: ReactNode }) => (
      <PreviewEnvContext.Provider
        value={{
          resolveSnapshot: () => null,
          resolveAsset: () => "asset://x",
          scrollRoot: null,
          paper: "A4",
        }}
      >
        {children}
      </PreviewEnvContext.Provider>
    );
    render(<CoverBlock block={{ ...cover, logo: null }} />, { wrapper: withLogo });
    expect(screen.queryByRole("img", { name: "Logo" })).toBeNull();
  });
});
