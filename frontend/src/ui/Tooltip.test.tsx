import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "./Tooltip";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Tooltip floating explanations", () => {
  it("fits beside viewport edges, follows scrolling and removes listeners on close", () => {
    const { unmount } = render(
      <Tooltip label="Help" side="right">
        <button>Action</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button");
    const rect = vi.spyOn(button.parentElement!, "getBoundingClientRect");
    rect.mockReturnValue({
      left: window.innerWidth - 24,
      right: window.innerWidth - 4,
      top: 1,
      bottom: 21,
      width: 20,
      height: 20,
    } as DOMRect);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(180);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(24);
    fireEvent.focus(button);
    const tip = screen.getByRole("tooltip");
    expect(tip.style.left).toBe(`${window.innerWidth - 210}px`);
    expect(tip.style.top).toBe("8px");
    rect.mockReturnValue({ left: 20, right: 40, top: 60, bottom: 80, width: 20, height: 20 } as DOMRect);
    fireEvent.scroll(window);
    expect(tip.style.left).toBe("46px");
    unmount();
    rect.mockClear();
    fireEvent.scroll(window);
    fireEvent.resize(window);
    expect(rect).not.toHaveBeenCalled();
  });
  it("escapes a clipping navigation ancestor and describes the focused control", () => {
    render(
      <nav style={{ overflow: "auto" }}>
        <Tooltip label="Create a dataset first" side="right">
          <button>Train</button>
        </Tooltip>
      </nav>,
    );
    fireEvent.focus(screen.getByRole("button"));
    const tip = screen.getByRole("tooltip");
    expect(screen.getByRole("navigation")).not.toContainElement(tip);
    expect(screen.getByRole("button")).toHaveAttribute("aria-describedby", tip.id);
    expect(tip).toHaveStyle({ position: "fixed" });
    fireEvent.blur(screen.getByRole("button"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("cancels a pending hover when unmounted", () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <Tooltip label="Help">
        <button>Action</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole("button").parentElement!);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels hover on leave and shows keyboard focus immediately", () => {
    vi.useFakeTimers();
    render(
      <Tooltip label="Help">
        <button>Action</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button");
    fireEvent.mouseEnter(button.parentElement!);
    fireEvent.mouseLeave(button.parentElement!);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.mouseLeave(button.parentElement!);
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows a shortcut as key caps after the label", () => {
    render(
      <Tooltip label="Annotations" shortcut="Shift+H">
        <button>Toggle</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole("button"));
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Annotations");
    expect([...tip.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["Shift", "H"]);
  });

  it("opens to the left and flips right at the viewport edge", () => {
    render(
      <Tooltip label="Help" side="left">
        <button>Action</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button");
    const rect = vi.spyOn(button.parentElement!, "getBoundingClientRect");
    rect.mockReturnValue({ left: 300, right: 320, top: 100, bottom: 120, width: 20, height: 20 } as DOMRect);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(180);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(24);
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip").style.left).toBe("114px");
    rect.mockReturnValue({ left: 20, right: 40, top: 100, bottom: 120, width: 20, height: 20 } as DOMRect);
    fireEvent.scroll(window);
    expect(screen.getByRole("tooltip").style.left).toBe("46px");
  });
});
