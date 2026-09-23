import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CLASS_ID, exampleClasses, exampleMapRun } from "@/test/fixtures";
import { ResultsPanel } from "./ResultsPanel";

const other = { ...exampleMapRun, id: "r2", model_name: "machinery-v4" };

function renderPanel(over = {}) {
  const props = {
    runs: [exampleMapRun, other],
    selected: [exampleMapRun.id],
    classes: exampleClasses,
    wholeMap: { [exampleMapRun.id]: { [CLASS_ID(1)]: 42, [CLASS_ID(4)]: 17 }, r2: { [CLASS_ID(1)]: 40 } },
    inView: { [exampleMapRun.id]: { [CLASS_ID(1)]: 3 } },
    inViewTruncated: false,
    scope: "map" as const,
    onScope: vi.fn(),
    minConf: 0.25,
    onMinConf: vi.fn(),
    hidden: new Set<string>(),
    onToggleClass: vi.fn(),
    ...over,
  };
  render(<ResultsPanel {...props} />);
  return props;
}

describe("ResultsPanel", () => {
  it("counts per class for the whole map, with a total", () => {
    renderPanel();
    expect(screen.getByRole("row", { name: /excavator/ })).toHaveTextContent("42");
    expect(screen.getByRole("row", { name: /dump_truck/ })).toHaveTextContent("17");
    expect(screen.getByRole("row", { name: /Total/ })).toHaveTextContent("59");
  });

  it("puts two runs side by side", () => {
    renderPanel({ selected: [exampleMapRun.id, "r2"] });
    const row = screen.getByRole("row", { name: /excavator/ });
    expect(row).toHaveTextContent("42");
    expect(row).toHaveTextContent("40");
    expect(screen.getByRole("columnheader", { name: /machinery-v4/ })).toBeInTheDocument();
  });

  it("shows in-view counts, or says to zoom in when the view is truncated", () => {
    renderPanel({ scope: "view" });
    expect(screen.getByRole("row", { name: /excavator/ })).toHaveTextContent("3");
    renderPanel({ scope: "view", inViewTruncated: true });
    expect(screen.getByText("Zoom in to count what is in view.")).toBeInTheDocument();
  });

  it("hides a class and changes the confidence", () => {
    const p = renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show excavator" }));
    expect(p.onToggleClass).toHaveBeenCalledWith(CLASS_ID(1));
    fireEvent.change(screen.getByLabelText("Minimum confidence"), { target: { value: "0.5" } });
    expect(p.onMinConf).toHaveBeenCalledWith(0.5);
  });
});
