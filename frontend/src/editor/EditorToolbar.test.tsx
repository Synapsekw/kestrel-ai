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
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(within(help).getByText("Ctrl+D")).toBeInTheDocument();
    expect(within(help).getByText("duplicate selected box")).toBeInTheDocument();
    fireEvent.keyDown(help, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
    fireEvent.click(button);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
