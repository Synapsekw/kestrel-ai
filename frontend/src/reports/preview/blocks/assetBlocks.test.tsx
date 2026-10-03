import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MAP_FIXTURE as MAP_BLOCK } from "../fixtures";
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
