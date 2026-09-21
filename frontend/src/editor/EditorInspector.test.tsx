import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CLASS_ID, exampleClasses, proposalBox } from "@/test/fixtures";
import { Button } from "@/ui";
import { EditorInspector } from "./EditorInspector";

function InspectorFixture({
  onClass,
  onReview,
}: {
  onClass: (id: string) => void;
  onReview: (id: string, action: "accept" | "reject") => void;
}) {
  const [activeClassId, setActiveClassId] = useState(CLASS_ID(1));
  return (
    <EditorInspector
      classes={exampleClasses}
      activeClassId={activeClassId}
      counts={{}}
      onSelect={(id) => {
        setActiveClassId(id);
        onClass(id);
      }}
      regions={{
        boxes: [proposalBox],
        classes: exampleClasses,
        selectedId: null,
        hoveredId: null,
        markedEmpty: false,
        onSelect: () => {},
        onHover: () => {},
        onSetClass: () => {},
        onDelete: () => {},
        onReview,
      }}
      reviewControls={<Button>Accept all (A)</Button>}
    />
  );
}

describe("Image inspector", () => {
  it("keeps the drawing class and decisions accessible with all classes folded", () => {
    const onClass = vi.fn(),
      onReview = vi.fn();
    render(<InspectorFixture onClass={onClass} onReview={onReview} />);
    const inspector = screen.getByRole("region", { name: "Image inspector" });
    const chooser = within(inspector).getByRole("combobox", { name: "Drawing class" });
    expect(chooser).toHaveValue(CLASS_ID(1));
    expect(within(inspector).getByRole("button", { name: "All classes" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.change(chooser, { target: { value: CLASS_ID(2) } });
    expect(onClass).toHaveBeenCalledWith(CLASS_ID(2));
    expect(chooser).toHaveValue(CLASS_ID(2));
    fireEvent.click(within(inspector).getByRole("button", { name: "Accept box 1" }));
    expect(onReview).toHaveBeenCalledWith(proposalBox.id, "accept");
    fireEvent.click(within(inspector).getByRole("button", { name: "Reject box 1" }));
    expect(onReview).toHaveBeenCalledWith(proposalBox.id, "reject");
    fireEvent.click(within(inspector).getByRole("button", { name: "All classes" }));
    expect(within(inspector).getByRole("button", { name: /excavator/ })).toBeVisible();
  });
});
