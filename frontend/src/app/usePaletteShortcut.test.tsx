import { describe, expect, it } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { isPaletteChord, usePaletteShortcut } from "./usePaletteShortcut";

describe("Ctrl K", () => {
  it("is Ctrl or Cmd with K, in either case, and nothing else", () => {
    const k = (over: Partial<KeyboardEvent>) =>
      isPaletteChord({ key: "k", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });
    expect(k({ ctrlKey: true })).toBe(true);
    expect(k({ metaKey: true })).toBe(true);
    expect(k({ ctrlKey: true, key: "K" })).toBe(true);
    expect(k({})).toBe(false);
    expect(k({ ctrlKey: true, shiftKey: true })).toBe(false);
    expect(k({ ctrlKey: true, altKey: true })).toBe(false);
  });

  it("opens from a text field, is not typed into it and never reaches the page's own handlers", () => {
    const { result } = renderHook(() => usePaletteShortcut());
    let reachedPage = false;
    render(<input aria-label="Note" />);
    const input = screen.getByLabelText("Note");
    input.addEventListener("keydown", () => (reachedPage = true));
    input.focus();
    let notCancelled = true;
    act(() => {
      notCancelled = fireEvent.keyDown(input, { key: "k", ctrlKey: true });
    });
    expect(result.current[0]).toBe(true);
    expect(notCancelled).toBe(false);
    expect(reachedPage).toBe(false);
  });
});
