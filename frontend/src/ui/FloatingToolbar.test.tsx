import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FloatingToolbar, type ToolDef } from "./FloatingToolbar";

function tools(onBox = vi.fn(), onPan = vi.fn()): ToolDef[] {
  return [
    {
      id: "select",
      icon: "fit",
      label: "Select",
      shortcut: "V",
      action: "tool-select",
      active: true,
      onClick: vi.fn(),
    },
    { id: "box", icon: "label", label: "Box", shortcut: "B", onClick: onBox },
    {
      id: "pan",
      icon: "map",
      label: "Pan",
      shortcut: "H",
      action: "tool-pan",
      disabled: true,
      onClick: onPan,
    },
  ];
}

afterEach(() => vi.restoreAllMocks());

describe("FloatingToolbar", () => {
  it("is a labelled glass toolbar whose buttons report their state and keys", () => {
    render(<FloatingToolbar label="Tools" tools={tools()} />);
    expect(screen.getByRole("toolbar", { name: "Tools" })).toHaveAttribute("data-glass", "float");
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Box" })).toHaveAttribute("aria-keyshortcuts", "B");
    expect(screen.getByRole("button", { name: "Pan" })).toBeDisabled();
  });

  it("binds the shortcuts while mounted and skips disabled tools", () => {
    const onBox = vi.fn();
    const onPan = vi.fn();
    const { unmount } = render(<FloatingToolbar label="Tools" tools={tools(onBox, onPan)} />);
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.keyDown(window, { key: "h" });
    expect(onBox).toHaveBeenCalledTimes(1);
    expect(onPan).not.toHaveBeenCalled();
    unmount();
    fireEvent.keyDown(window, { key: "b" });
    expect(onBox).toHaveBeenCalledTimes(1);
  });

  it("names the tool and its key on focus: Box · B", () => {
    render(<FloatingToolbar label="Tools" tools={tools()} />);
    fireEvent.focus(screen.getByRole("button", { name: "Box" }));
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Box");
    expect(tip.querySelector("kbd")).toHaveTextContent("B");
  });

  it("moves focus with the arrow keys, skips disabled tools, and keeps the keys from the workspace", () => {
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    render(<FloatingToolbar label="Tools" tools={tools()} />);
    const select = screen.getByRole("button", { name: "Select" });
    select.focus();
    fireEvent.keyDown(select, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: "Box" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "Box" }), { key: "ArrowDown" });
    expect(select).toHaveFocus();
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });
});
