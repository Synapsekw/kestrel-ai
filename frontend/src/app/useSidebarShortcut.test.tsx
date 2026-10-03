import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GLOBAL_KEYS } from "@/ui/keymap";
import { isSidebarChord, useSidebarShortcut } from "./useSidebarShortcut";

function Probe({ onToggle }: { onToggle: () => void }) {
  useSidebarShortcut(onToggle);
  return <input aria-label="Filter" />;
}

describe("useSidebarShortcut", () => {
  it("recognises Ctrl+B and Cmd+B only", () => {
    const k = { key: "b", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
    expect(isSidebarChord(k)).toBe(true);
    expect(isSidebarChord({ ...k, ctrlKey: false, metaKey: true })).toBe(true);
    expect(isSidebarChord({ ...k, ctrlKey: false })).toBe(false); // plain B is the Box tool
    expect(isSidebarChord({ ...k, shiftKey: true })).toBe(false);
    expect(isSidebarChord({ ...k, altKey: true })).toBe(false);
  });

  it("toggles on Ctrl+B outside a text field and not inside one", () => {
    const onToggle = vi.fn();
    render(<Probe onToggle={onToggle} />);
    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText("Filter"), { key: "b", ctrlKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("is listed in the keymap for the ? sheet", () => {
    const entry = GLOBAL_KEYS.find((e) => e.action === "toggle-sidebar");
    expect(entry?.keys).toEqual(["Ctrl+B"]);
    expect(entry?.help).toBe("Show or hide the sidebar");
  });
});
