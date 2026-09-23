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
    selectedClassId: null,
    zones: [exampleZone],
    labels: [exampleLabel],
    warnCount: 2,
    seededCount: 5,
    runs: [exampleMapRun],
    minConf: 0.4,
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

  it("seeds a zone from a run at the current confidence", () => {
    const p = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Copy detections at 40 % confidence or higher" }));
    expect(p.onSeed).toHaveBeenCalledWith(exampleMapRun.id, exampleZone.id, 0.4);
  });

  it("asks for a zone first when there is none", () => {
    renderPanel({ zones: [] });
    expect(screen.getByText(/Draw a zone around an area you will label completely/)).toBeInTheDocument();
  });

  it("with nothing selected, says a class sets what you draw next", () => {
    renderPanel();
    expect(screen.getByText("A class here sets what you draw next.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /excavator/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("with a label selected, says a class recolours it and highlights its own class", () => {
    renderPanel({ selectedClassId: CLASS_ID(4) });
    expect(screen.getByText("A class here recolours the selected label.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dump_truck/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /excavator/ })).toHaveAttribute("aria-pressed", "false");
  });
});
