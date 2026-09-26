import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { keysFor } from "@/ui/keymap";
import { routeInfo, sheetScope } from "./routeModel";
import { ShortcutSheet } from "./ShortcutSheet";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <input aria-label="Name" />
      <ShortcutSheet />
    </MemoryRouter>,
  );
}

describe("ShortcutSheet (F §5.6: rendered from DS's keymap table)", () => {
  it("opens on ? with every entry of the scope's table, and closes on Escape", () => {
    renderAt("/p/p1/maps/m1");
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    const sheet = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    const rows = within(sheet).getAllByRole("row").slice(1); // header row first
    expect(rows).toHaveLength(keysFor("maps").length);
    expect(within(sheet).getByText("Command palette")).toBeInTheDocument();
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
  });

  it("does not open while typing in a field", () => {
    renderAt("/projects");
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "?", shiftKey: true });
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
  });

  it("uses the workspace scope of the tab", () => {
    expect(sheetScope(routeInfo("/p/p1/images/i1"))).toBe("images");
    expect(sheetScope(routeInfo("/p/p1/clouds"))).toBe("clouds");
    expect(sheetScope(routeInfo("/p/p1/overview"))).toBeNull();
    expect(sheetScope(routeInfo("/catalogue"))).toBeNull();
  });

  it("uses the findings scope on the Findings tab, even though it has no entries yet (controller ruling F6)", () => {
    expect(sheetScope(routeInfo("/p/p1/findings"))).toBe("findings");
    renderAt("/p/p1/findings");
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    const sheet = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    // The findings scope has no tool keys yet: only the global and review rows show, and the
    // sheet still renders without error.
    const rows = within(sheet).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(keysFor("findings").length);
    expect(rows).toHaveLength(keysFor(null).length);
  });
});
