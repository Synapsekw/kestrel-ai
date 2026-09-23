import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CLASS_ID, exampleClasses, exampleLabel, exampleMapRun, exampleZone } from "@/test/fixtures";
import { LabelPanel } from "./LabelPanel";

function renderPanel(over = {}) {
  const props = {
    tool: "pan" as const,
    onTool: vi.fn(),
    classes: exampleClasses,
    activeClassId: CLASS_ID(1),
    onClass: vi.fn(),
    zones: [exampleZone],
    labels: [exampleLabel],
    warnCount: 2,
    seededCount: 5,
    runs: [exampleMapRun],
    onSeed: vi.fn(),
    onRenameZone: vi.fn(),
    onDeleteZone: vi.fn(),
    canUndo: true,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...over,
  };
  render(<LabelPanel {...props} />);
  return props;
}

describe("LabelPanel", () => {
  it("switches tools and classes", () => {
    const p = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "Box" }));
    expect(p.onTool).toHaveBeenCalledWith("box");
    fireEvent.click(screen.getByRole("button", { name: /dump_truck/ }));
    expect(p.onClass).toHaveBeenCalledWith(CLASS_ID(4));
  });

  it("warns about labels outside zones and unchecked seeds", () => {
    renderPanel();
    expect(screen.getByText("2 labels are outside every zone and will not count.")).toBeInTheDocument();
    expect(screen.getByText("5 seeded from a run, not yet checked.")).toBeInTheDocument();
  });

  it("seeds a zone from a run", () => {
    const p = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Copy detections into labels" }));
    expect(p.onSeed).toHaveBeenCalledWith(exampleMapRun.id, exampleZone.id, 0.25);
  });

  it("asks for a zone first when there is none", () => {
    renderPanel({ zones: [] });
    expect(screen.getByText(/Draw a zone around an area you will label completely/)).toBeInTheDocument();
  });
});
