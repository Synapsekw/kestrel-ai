import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { EditorToolbar, type ToolbarProps } from "./EditorToolbar";

const noop = () => {};
const props: ToolbarProps = {
  fileName: "a.jpg",
  position: { index: 0, count: 2 },
  zoom: 1,
  pending: 0,
  canUndo: false,
  canRedo: false,
  onPrev: noop,
  onNext: noop,
  onFit: noop,
  onOneToOne: noop,
  onUndo: noop,
  onRedo: noop,
};

describe("EditorToolbar shortcuts help", () => {
  it("opens a list of the shortcuts on click and closes it again", () => {
    render(<EditorToolbar {...props} />);
    const button = screen.getByRole("button", { name: "Keyboard shortcuts" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
    fireEvent.click(button);
    const help = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(help).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(within(help).getByText("Ctrl+D")).toBeInTheDocument();
    expect(within(help).getByText("duplicate selected box")).toBeInTheDocument();
    // A class key re-classes the selected box (a new box stays selected): the help must say so.
    expect(
      within(help).getByText(
        "class for the next box; with a box selected, changes that box's class (Esc first to keep it)",
      ),
    ).toBeInTheDocument();
    fireEvent.keyDown(help, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
    fireEvent.click(button);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the icon buttons' names and shows each hotkey in the tooltip", () => {
    render(<EditorToolbar {...props} />);
    const titles: Record<string, string> = {
      Previous: "Previous image (Ctrl+Left)",
      Next: "Next image (Ctrl+Right)",
      Fit: "Fit (F)",
      "1:1": "1:1 (0 or Ctrl+1)",
      Undo: "Undo (Ctrl+Z)",
      Redo: "Redo (Ctrl+Y)",
    };
    for (const [name, title] of Object.entries(titles)) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("title", title);
    }
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("says Saving while a change is in flight and holds undo until it settles", () => {
    render(<EditorToolbar {...props} pending={1} canUndo />);
    expect(screen.getByRole("status")).toHaveTextContent("Saving…");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("puts the way back first in the toolbar", () => {
    render(<EditorToolbar {...props} lead={<a href="/back">Back</a>} />);
    const toolbar = screen.getByRole("link", { name: "Back" }).parentElement;
    expect(toolbar?.firstElementChild).toBe(screen.getByRole("link", { name: "Back" }));
  });
});
