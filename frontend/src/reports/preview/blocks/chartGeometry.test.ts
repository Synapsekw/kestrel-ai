import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ChartBlock } from "./ChartBlock";
import { chartLayout, niceMax } from "./chartGeometry";

const PAL = ["#111111", "#222222"];

describe("chart geometry", () => {
  it("rounds the axis up to 1, 2, 2.5 or 5 times a power of ten", () => {
    expect([0, -3, 4, 7, 23, 100, 0.3].map(niceMax)).toEqual([1, 1, 5, 10, 25, 100, 0.5]);
  });

  it("draws grouped bars proportional to the value", () => {
    const l = chartLayout("bar", [{ name: "A", values: [2, 4] }], ["x", "y"], PAL, 174, 60);
    expect(l.max).toBe(5);
    expect(l.plot).toEqual({ x: 14, y: 4, w: 158, h: 48 });
    expect(l.bars).toHaveLength(2);
    expect(l.bars[0].h).toBeCloseTo(19.2);
    expect(l.bars[1].h).toBeCloseTo(38.4);
    expect(l.bars[0].y).toBeCloseTo(32.8);
    expect(l.bars[0].colour).toBe("#111111");
    expect(l.xLabels.map((x) => x.text)).toEqual(["x", "y"]);
  });

  it("stacks series on each other and scales to the tallest stack", () => {
    const l = chartLayout(
      "stacked_bar",
      [
        { name: "A", values: [1, 2] },
        { name: "B", values: [3, 1], colour: "#abcdef" },
      ],
      ["x", "y"],
      PAL,
    );
    expect(l.max).toBe(5);
    const [a0, b0] = l.bars.filter((b) => b.label === "x");
    expect(b0.y + b0.h).toBeCloseTo(a0.y);
    expect(b0.colour).toBe("#abcdef");
  });

  it("draws a line through every label and clamps negative or missing values to 0", () => {
    const l = chartLayout("line", [{ name: "A", values: [3, -2, Number.NaN] }], ["a", "b", "c"], PAL);
    expect(l.lines[0].points).toHaveLength(3);
    expect(l.lines[0].points[1][1]).toBeCloseTo(52);
    expect(l.lines[0].points[2][1]).toBeCloseTo(52);
  });

  it("survives an empty chart", () => {
    const l = chartLayout("bar", [], [], PAL);
    expect(l.bars).toEqual([]);
    expect(l.max).toBe(1);
  });

  it("clamps a null value to 0, same as negative or non-finite", () => {
    const l = chartLayout("bar", [{ name: "A", values: [2, null] }], ["x", "y"], PAL, 174, 60);
    expect(l.bars[1].value).toBe(0);
    expect(l.bars[1].h).toBe(0);
  });

  it("falls back to the palette when a series colour is null", () => {
    const l = chartLayout("bar", [{ name: "A", values: [2], colour: null }], ["x"], PAL, 174, 60);
    expect(l.bars[0].colour).toBe("#111111");
  });
});

describe("ChartBlock", () => {
  it("is an image named by kind, series and unit, with a legend for several series", () => {
    render(
      createElement(ChartBlock, {
        block: {
          kind: "chart",
          chart: "stacked_bar",
          title: null,
          series: [
            { name: "Open", values: [4, 3], colour: null },
            { name: "Closed", values: [2, 5], colour: null },
          ],
          x_labels: ["Major", "Minor"],
          unit: "findings",
        },
      }),
    );
    expect(screen.getByRole("img", { name: "Stacked bar chart of Open, Closed (findings)" })).toBeInTheDocument();
    expect(screen.getAllByText("Open").length).toBeGreaterThan(0);
  });

  it("is named by title, not series, when a title is set, and prints the title as a caption", () => {
    render(
      createElement(ChartBlock, {
        block: {
          kind: "chart",
          chart: "bar",
          title: "Findings by type",
          series: [{ name: "Findings", values: [12, 8], colour: null }],
          x_labels: ["Crack", "Spall"],
          unit: "findings",
        },
      }),
    );
    expect(screen.getByRole("img", { name: "Bar chart of Findings by type (findings)" })).toBeInTheDocument();
    expect(screen.getByText("Findings by type")).toBeInTheDocument();
  });

  it("omits a null or empty unit from the name", () => {
    render(
      createElement(ChartBlock, {
        block: {
          kind: "chart",
          chart: "line",
          title: null,
          series: [{ name: "Excavators", values: [3, 5, 4], colour: null }],
          x_labels: ["Jul", "Aug", "Sep"],
          unit: "",
        },
      }),
    );
    expect(screen.getByRole("img", { name: "Line chart of Excavators" })).toBeInTheDocument();
  });
});
