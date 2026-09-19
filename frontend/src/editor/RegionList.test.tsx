import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { exampleClasses, personBox, proposalBox, CLASS_ID } from "@/test/fixtures";
import { provenanceLabel } from "./labels";
import { RegionList } from "./RegionList";

describe("RegionList", () => {
  it("shows class, confidence, provenance and review state and dispatches edits", () => {
    const onSelect = vi.fn();
    const onSetClass = vi.fn();
    const onDelete = vi.fn();
    render(
      <RegionList
        boxes={[personBox, proposalBox]}
        classes={exampleClasses}
        selectedId={personBox.id}
        hoveredId={null}
        markedEmpty={false}
        onSelect={onSelect}
        onHover={() => {}}
        onSetClass={onSetClass}
        onDelete={onDelete}
        onReview={() => {}}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(rows[0]).toHaveTextContent("Person");
    expect(rows[0]).toHaveTextContent("Accepted");
    expect(rows[1]).toHaveTextContent("81%");
    expect(rows[1]).toHaveTextContent("Model yolo11m-coco");
    expect(rows[1]).toHaveTextContent("Proposal");
    expect(screen.getByLabelText("Class of box 2")).toHaveValue(CLASS_ID(4));

    fireEvent.click(rows[1]);
    expect(onSelect).toHaveBeenCalledWith(proposalBox.id);
    // A long model name stays on one line (truncated); the full text is on hover.
    const badge = screen.getByText("Model yolo11m-coco");
    expect(badge).toHaveAttribute("title", "Model yolo11m-coco");
    expect(badge.className).toContain("truncate");
    fireEvent.change(screen.getByLabelText("Class of box 1"), { target: { value: CLASS_ID(3) } });
    expect(onSetClass).toHaveBeenCalledWith(personBox.id, CLASS_ID(3));
    fireEvent.click(screen.getByRole("button", { name: "Delete box 1" }));
    expect(onDelete).toHaveBeenCalledWith(personBox.id);
  });

  it("does not invite N while the confidence floor hides proposals: N would reject them unseen", () => {
    render(
      <RegionList
        boxes={[]}
        classes={exampleClasses}
        selectedId={null}
        hoveredId={null}
        markedEmpty={false}
        hiddenByFloor={10}
        onSelect={() => {}}
        onHover={() => {}}
        onSetClass={() => {}}
        onDelete={() => {}}
        onReview={() => {}}
      />,
    );
    expect(
      screen.getByText(
        "10 proposals are hidden by the confidence floor. Lower it to see them before deciding that nothing is here.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Press N/)).toBeNull();
  });

  it("shows the empty state text, and a different one once the image is marked empty", () => {
    const { rerender } = render(
      <RegionList
        boxes={[]}
        classes={exampleClasses}
        selectedId={null}
        hoveredId={null}
        markedEmpty={false}
        onSelect={() => {}}
        onHover={() => {}}
        onSetClass={() => {}}
        onDelete={() => {}}
        onReview={() => {}}
      />,
    );
    expect(screen.getByText(/Nothing here\? Press N\.$/)).toBeInTheDocument();

    rerender(
      <RegionList
        boxes={[]}
        classes={exampleClasses}
        selectedId={null}
        hoveredId={null}
        markedEmpty={true}
        onSelect={() => {}}
        onHover={() => {}}
        onSetClass={() => {}}
        onDelete={() => {}}
        onReview={() => {}}
      />,
    );
    expect(screen.getByText("Marked empty: no machinery on this image.")).toBeInTheDocument();
  });

  it("labels provenance", () => {
    expect(provenanceLabel(personBox.provenance)).toBe("Person");
    expect(provenanceLabel(proposalBox.provenance)).toBe("Model yolo11m-coco");
    expect(
      provenanceLabel({
        kind: "cloud_provider",
        model_id: null,
        provider: "anthropic",
        model_name: "claude-opus-5",
        query_run_id: "q",
      }),
    ).toBe("Cloud anthropic");
  });
});
