import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BlockOf } from "@/api/reports";
import { FIXTURE_BLOCKS, MAP_FIXTURE as MAP_BLOCK } from "../fixtures";
import { PreviewEnvContext } from "../PreviewContext";
import { coverBrandOf } from "../coverBrand";
import { FindingBlock } from "./FindingBlock";
import { TableBlock } from "./TableBlock";
import { AssetMapBlock } from "./AssetMapBlock";
import { BlockView } from "./BlockView";

describe("AssetMapBlock", () => {
  it("draws the bands, ticks, silhouette and one dot per finding, with the caption", () => {
    const { container } = render(<AssetMapBlock block={MAP_BLOCK} />);
    const svg = screen.getByRole("img", { name: "Findings map of Tower A" });
    expect(svg.getAttribute("viewBox")).toBe("0 0 760 400");
    expect(container.querySelectorAll("[data-dot]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-band]")).toHaveLength(2);
    expect(container.querySelector("polygon")).not.toBeNull();
    expect(screen.getByText("Upper floors")).toBeInTheDocument();
    expect(screen.getByText("F-0042")).toBeInTheDocument(); // the dot's <title>
    expect(screen.getByText(MAP_BLOCK.caption)).toBeInTheDocument();
  });

  it("is reachable through BlockView", () => {
    const { container } = render(<BlockView block={MAP_BLOCK} />);
    expect(container.querySelector('[data-block="asset_map"]')).not.toBeNull();
  });
});

const base = FIXTURE_BLOCKS.finding_pages[0] as BlockOf<"finding">;
const ASSET_FINDING: BlockOf<"finding"> = {
  ...base,
  kv: [
    ["Height", "41.2 m above street level"],
    ["Zone", "Upper floors"],
  ],
  asset: {
    kicker: "Finding F-0042 � Upper floors � West elevation � seen in 3 photos",
    height_locator: { ...MAP_BLOCK.drawing, width: 64, height: 200, font_size: 6, bands: [], x_ticks: [] },
  },
};

describe("FindingBlock with an asset panel", () => {
  it("shows the kicker and the facts beside the height locator", () => {
    render(<FindingBlock block={ASSET_FINDING} />);
    expect(screen.getByText(ASSET_FINDING.asset!.kicker)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Height on the asset" })).toBeInTheDocument();
    expect(screen.getByText("41.2 m above street level")).toBeInTheDocument();
  });

  it("prints as before without one", () => {
    render(<FindingBlock block={{ ...base, asset: null }} />);
    expect(screen.queryByRole("img", { name: "Height on the asset" })).toBeNull();
  });
});

describe("brand head fill", () => {
  const brand = coverBrandOf(
    {
      colors: {
        accent: "#BC0000",
        accent_dark: "#9E0000",
        navy: "#141D2D",
        ink: "#1A1A1A",
        pale: "#FFE5E5",
        line: "#E7E4DE",
      },
      font_text: null,
      font_numerals: null,
    } as Parameters<typeof coverBrandOf>[0],
    null,
  );

  it("comes from D2's overlay", () => {
    expect(brand.headFill).toBe("#FFE5E5");
  });

  it("fills the table head and the finding band", () => {
    const table = FIXTURE_BLOCKS.findings_table.find((b) => b.kind === "table") as BlockOf<"table">;
    const { container } = render(
      <PreviewEnvContext.Provider
        value={{
          resolveSnapshot: () => null,
          resolveAsset: () => null,
          scrollRoot: null,
          paper: "A4",
          brand,
        }}
      >
        <TableBlock block={table} />
        <FindingBlock block={ASSET_FINDING} />
      </PreviewEnvContext.Provider>,
    );
    expect((container.querySelector("thead tr") as HTMLElement).style.background).toBe("rgb(255, 229, 229)");
    expect((container.querySelector("article header") as HTMLElement).style.background).toBe(
      "rgb(255, 229, 229)",
    );
  });
});
