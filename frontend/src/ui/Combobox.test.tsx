import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Combobox, ComboboxList, filterItems, type ComboItem } from "./Combobox";

const ITEMS: ComboItem[] = [
  { id: "crack", label: "Crack", hotkey: "1", colour: "#ff5a4f" },
  { id: "spall", label: "Spalling", hotkey: "2", colour: "#ff9c3a" },
  { id: "rust", label: "Corrosion", hint: "Steel", hotkey: "c", colour: "#e2bf2e" },
];

describe("filterItems", () => {
  it("matches the label and the hint, case-insensitively", () => {
    expect(filterItems(ITEMS, "ST").map((i) => i.id)).toEqual(["rust"]);
    expect(filterItems(ITEMS, "  ")).toHaveLength(3);
  });
});

describe("ComboboxList", () => {
  it("filters, moves with ↓ and picks with Enter", async () => {
    const onSelect = vi.fn();
    render(<ComboboxList label="Type" items={ITEMS} value={null} onSelect={onSelect} />);
    const input = screen.getByRole("combobox", { name: "Type" });
    await userEvent.type(input, "s");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await userEvent.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1].id);
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("rust");
  });

  it("answers catalogue hotkeys only while the filter is empty", async () => {
    const onSelect = vi.fn();
    render(<ComboboxList label="Type" items={ITEMS} value={null} onSelect={onSelect} />);
    const input = screen.getByRole("combobox", { name: "Type" });
    input.focus();
    await userEvent.keyboard("2");
    expect(onSelect).toHaveBeenCalledWith("spall");
    expect(input).toHaveValue("");
    await userEvent.keyboard("r2");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("r2");
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("keeps its keys from the workspace shortcuts", async () => {
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    render(<ComboboxList label="Type" items={ITEMS} value="crack" onSelect={() => {}} />);
    screen.getByRole("combobox", { name: "Type" }).focus();
    await userEvent.keyboard("{ArrowDown}1");
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });
});

describe("Combobox", () => {
  it("shows the choice, opens the picker, closes on a pick and returns focus", async () => {
    function Host() {
      const [value, setValue] = useState<string | null>("crack");
      return <Combobox label="Type" items={ITEMS} value={value} onChange={setValue} />;
    }
    render(<Host />);
    await userEvent.click(screen.getByRole("button", { name: "Type: Crack" }));
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveFocus();
    expect(screen.getByRole("option", { name: /Crack/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("2");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Type: Spalling" })).toHaveFocus();
  });

  it("keeps ArrowDown on the closed trigger from reaching the workspace shortcuts", async () => {
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    render(<Combobox label="Type" items={ITEMS} value="crack" onChange={() => {}} />);
    screen.getByRole("button", { name: "Type: Crack" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onWindow).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Type" })).toBeInTheDocument();
    window.removeEventListener("keydown", onWindow);
  });
});
