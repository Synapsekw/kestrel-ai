import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Segmented } from "./Segmented";
import { Tabs, type TabItem } from "./Tabs";

/** jsdom has no layout: give elements with data-item-id an offsetLeft and offsetWidth. */
function geometry(map: Record<string, [number, number]>) {
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
    return map[this.dataset.itemId ?? ""]?.[0] ?? 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return map[this.dataset.itemId ?? ""]?.[1] ?? 0;
  });
}

afterEach(() => vi.restoreAllMocks());

const ITEMS: TabItem[] = [
  { id: "types", label: "Types", count: 12 },
  { id: "severity", label: "Severity" },
  { id: "archived", label: "Archived", disabled: true },
  { id: "log", label: "Log" },
];

function Host() {
  const [value, setValue] = useState("types");
  return <Tabs label="Catalogue" items={ITEMS} value={value} onChange={setValue} />;
}

describe("Tabs", () => {
  it("slides the indicator under the active tab", () => {
    geometry({ types: [0, 90], severity: [120, 80] });
    render(<Host />);
    const bar = screen
      .getByRole("tablist", { name: "Catalogue" })
      .querySelector<HTMLElement>('[data-part="indicator"]')!;
    expect(bar.style.transform).toBe("translateX(0px) scaleX(0.9)");
    fireEvent.click(screen.getByRole("tab", { name: "Severity" }));
    expect(bar.style.transform).toBe("translateX(120px) scaleX(0.8)");
  });

  it("roves with the arrows, Home and End, skips disabled tabs, and keeps the keys from the workspace", () => {
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    render(<Host />);
    const types = screen.getByRole("tab", { name: /Types/ });
    expect(types).toHaveAttribute("aria-selected", "true");
    expect(types).toHaveAttribute("tabindex", "0");
    types.focus();
    fireEvent.keyDown(types, { key: "ArrowRight" });
    const severity = screen.getByRole("tab", { name: "Severity" });
    expect(severity).toHaveFocus();
    expect(severity).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(severity, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Log" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(types).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("tab", { name: "Log" })).toHaveFocus();
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });

  it("shows the count badge in mono", () => {
    render(<Host />);
    expect(screen.getByText("12").className).toContain("font-mono");
  });

  it("as links, marks the tab of the current route", () => {
    render(
      <MemoryRouter initialEntries={["/p/1/findings/abc"]}>
        <Tabs
          asLinks
          label="Project"
          items={[
            { id: "overview", label: "Overview", to: "/p/1/overview" },
            { id: "findings", label: "Findings", to: "/p/1/findings", count: 47 },
          ]}
        />
      </MemoryRouter>,
    );
    const findings = screen.getByRole("tab", { name: /Findings/ });
    expect(findings).toHaveAttribute("aria-selected", "true");
    expect(findings).toHaveAttribute("href", "/p/1/findings");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "false");
  });

  // Review Focus 5 / controller ruling P5: a width measured before the web font has finished
  // loading is wrong (the fallback font is a different width); useSlidingIndicator re-measures
  // once `document.fonts.ready` resolves. Stub `document.fonts` with a promise this test
  // controls, change the (mocked) geometry after the initial paint, resolve the promise, and
  // assert the indicator is rewritten to the new geometry — proving the offset/width getters are
  // read again, not just cached from the first layout pass.
  it("re-measures the indicator once the web fonts finish loading", async () => {
    const widths: Record<string, [number, number]> = { types: [0, 90], severity: [120, 80] };
    geometry(widths);

    let resolveFonts!: () => void;
    const ready = new Promise<FontFaceSet>((resolve) => {
      resolveFonts = () => resolve({} as FontFaceSet);
    });
    const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready },
    });

    try {
      render(<Host />);
      const bar = screen
        .getByRole("tablist", { name: "Catalogue" })
        .querySelector<HTMLElement>('[data-part="indicator"]')!;
      expect(bar.style.transform).toBe("translateX(0px) scaleX(0.9)");

      // Simulate the fallback-font measurement having been wrong: the real width only appears
      // once the web font is in.
      widths.types = [0, 140];

      await act(async () => {
        resolveFonts();
        await ready;
      });

      expect(bar.style.transform).toBe("translateX(0px) scaleX(1.4)");
    } finally {
      if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
      else delete (document as { fonts?: unknown }).fonts;
    }
  });
});

describe("Segmented", () => {
  it("slides its thumb to the checked option and changes with the arrow keys", () => {
    geometry({ grid: [3, 60], map: [65, 50] });
    function View() {
      const [value, setValue] = useState<"grid" | "map">("grid");
      return (
        <Segmented
          label="View"
          value={value}
          onChange={setValue}
          options={[
            { value: "grid", label: "Grid" },
            { value: "map", label: "Map", count: 3 },
          ]}
        />
      );
    }
    render(<View />);
    const thumb = screen
      .getByRole("radiogroup", { name: "View" })
      .querySelector<HTMLElement>('[data-part="thumb"]')!;
    expect(thumb.style.width).toBe("60px");
    expect(thumb.style.transform).toBe("translateX(3px)");
    const grid = screen.getByRole("radio", { name: "Grid" });
    grid.focus();
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    const map = screen.getByRole("radio", { name: /Map/ });
    expect(map).toHaveAttribute("aria-checked", "true");
    expect(map).toHaveFocus();
    expect(thumb.style.transform).toBe("translateX(65px)");
  });
});
