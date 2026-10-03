import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_SEVERITY_SCALE } from "@/ui";
import {
  ASSET_FINDING_ID,
  ASSET_FINDING_ID_2,
  exampleAssetFinding,
  exampleAssetFinding2,
  exampleAssetModel,
} from "@/test/assetFindingFixtures";
import { toMapDot } from "./useAssetMapDots";
import { FindingsMap } from "./FindingsMap";
import { geometry } from "./geometry";

const h = vi.hoisted(() => ({
  geo: {
    width: 760,
    height: 400,
    plot: { x: 110, y: 10, w: 512, h: 352 },
    sil_cx: 36,
    zone_label_x: 632,
    dot_r: 5.5,
    top_m: 80,
    step_m: 10,
    silhouette: [
      [20, 10],
      [52, 10],
      [56, 362],
      [16, 362],
    ],
    levels: [{ value: 60, y: 98, x1: 14, x2: 58 }],
    zones: [
      { id: "head", label: "Head", y: 10, h: 28, label_y: 28, shade: true },
      { id: "shaft", label: "Shaft", y: 38, h: 270, label_y: 176, shade: false },
      { id: "base", label: "Base", y: 308, h: 54, label_y: 339, shade: true },
    ],
    y_ticks: [{ value: 0, y: 362 }],
    x_ticks: [
      { label: "N", x: 110 },
      { label: "E", x: 238 },
    ],
    axis_title: "Side",
    dots: [
      { id: "f0000000-9999-4000-8000-000000000401", x: 238, y: 196, severity: 3 },
      { id: "f0000000-9999-4000-8000-000000000402", x: 400, y: 30, severity: 1 },
    ],
    unplaced: 0,
  },
}));
vi.mock("./geometry", () => ({ geometry: vi.fn(() => h.geo) }));

const dots = [toMapDot(exampleAssetFinding)!, toMapDot(exampleAssetFinding2)!];

function draw(onOpen = vi.fn()) {
  render(
    <FindingsMap
      review={exampleAssetModel.review!}
      frame={exampleAssetModel.frame!}
      dots={dots}
      onOpen={onOpen}
    />,
  );
  return onOpen;
}

describe("FindingsMap", () => {
  it("lays out through the shared geometry with the model's review, frame and dots", () => {
    draw();
    expect(geometry).toHaveBeenCalledWith(exampleAssetModel.review, exampleAssetModel.frame, dots);
  });

  it("draws the silhouette, levels, zone bands and one dot per finding", () => {
    draw();
    expect(
      screen.getByRole("group", { name: "Findings map, 2 findings by height and side" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /F-\d+/ })).toHaveLength(2);
    expect(screen.getByTestId("silhouette")).toHaveAttribute("d", "M 20 10 L 52 10 L 56 362 L 16 362 Z");
    expect(screen.getAllByTestId("level")).toHaveLength(1);
    expect(screen.getAllByTestId("zone-band").map((z) => z.textContent)).toEqual(["Head", "Shaft", "Base"]);
    expect(screen.getAllByTestId("map-dot")).toHaveLength(2);
  });

  it("colours a dot by its severity level, as data through --c", () => {
    draw();
    const [first] = screen.getAllByTestId("map-dot");
    const colour = DEFAULT_SEVERITY_SCALE.find((l) => l.level === 3)!.colour;
    expect(first).toHaveClass("fill-[color:var(--c)]");
    expect(first.style.getPropertyValue("--c")).toBe(colour);
  });

  it("shows a tip on hover and on focus, and hides it on leave", () => {
    draw();
    const [first] = screen.getAllByTestId("map-dot");
    fireEvent.mouseEnter(first);
    expect(screen.getByRole("tooltip")).toHaveTextContent("F-0401");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Shaft · E · 42.5 m");
    fireEvent.mouseLeave(first);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.focus(first);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("opens a finding on click, Enter and Space", () => {
    const onOpen = draw();
    const [first, second] = screen.getAllByTestId("map-dot");
    fireEvent.click(first);
    expect(onOpen).toHaveBeenLastCalledWith(ASSET_FINDING_ID);
    fireEvent.keyDown(second, { key: "Enter" });
    expect(onOpen).toHaveBeenLastCalledWith(ASSET_FINDING_ID_2);
    fireEvent.keyDown(second, { key: " " });
    expect(onOpen).toHaveBeenCalledTimes(3);
  });
});
