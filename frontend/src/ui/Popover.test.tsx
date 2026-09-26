import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";
import { placeFloating } from "./floating";
import { MenuButton, type MenuItem } from "./Menu";
import { Popover } from "./Popover";

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});
const VIEW = { width: 1000, height: 800 };

describe("placeFloating", () => {
  it("opens below, aligned to the start", () => {
    expect(
      placeFloating(rect(100, 100, 80, 30), { width: 200, height: 150 }, "bottom", "start", VIEW),
    ).toEqual({
      left: 100,
      top: 136,
      side: "bottom",
    });
  });

  it("flips above when there is no room below", () => {
    expect(
      placeFloating(rect(100, 700, 80, 30), { width: 200, height: 150 }, "bottom", "start", VIEW),
    ).toEqual({
      left: 100,
      top: 544,
      side: "top",
    });
  });

  it("aligns to the end and clamps into the viewport", () => {
    expect(
      placeFloating(rect(900, 100, 80, 30), { width: 200, height: 100 }, "bottom", "end", VIEW).left,
    ).toBe(780);
    expect(
      placeFloating(rect(2, 100, 20, 30), { width: 200, height: 100 }, "bottom", "center", VIEW).left,
    ).toBe(8);
  });

  it("opens to the right of a rail entry, centred", () => {
    expect(placeFloating(rect(10, 200, 42, 42), { width: 160, height: 40 }, "right", "center", VIEW)).toEqual(
      {
        left: 58,
        top: 201,
        side: "right",
      },
    );
  });
});

function PopHost() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchor} onClick={() => setOpen((o) => !o)}>
        Layers
      </button>
      <button>Elsewhere</button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} label="Layer settings">
        <label>
          Opacity <input />
        </label>
      </Popover>
    </>
  );
}

describe("Popover", () => {
  it("is anchored glass that takes focus; Esc closes it and returns focus", async () => {
    render(<PopHost />);
    await userEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.getByRole("dialog", { name: "Layer settings" })).toHaveAttribute("data-glass", "float");
    expect(screen.getByLabelText("Opacity")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Layers" })).toHaveFocus();
  });

  it("closes on an outside press, not on a press inside, and its anchor toggles it", async () => {
    render(<PopHost />);
    const anchor = screen.getByRole("button", { name: "Layers" });
    await userEvent.click(anchor);
    await userEvent.click(screen.getByLabelText("Opacity"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(anchor);
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(anchor);
    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

const items = (onSelect = vi.fn()): MenuItem[] => [
  { id: "photos", label: "Photos", icon: "images", onSelect },
  {
    id: "drawing",
    label: "Drawing",
    icon: "drawing",
    disabled: true,
    hint: "Arrives with the Maps workspace",
    onSelect,
  },
  { id: "cloud", label: "Point cloud", icon: "cloud", shortcut: "Ctrl+Shift+P", onSelect },
];

describe("Menu", () => {
  it("opens from its button, skips disabled items, selects with Enter and returns focus", async () => {
    const onSelect = vi.fn();
    render(<MenuButton label="Add data" items={items(onSelect)} />);
    const button = screen.getByRole("button", { name: "Add data" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Add data" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Photos" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /Point cloud/ })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("wraps ArrowUp to the last enabled item and keeps its keys from the workspace", async () => {
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    render(<MenuButton label="More" items={items()} />);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: /Point cloud/ })).toHaveFocus();
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });

  it("keeps focus where an item's onSelect put it instead of returning it to the button", async () => {
    function Host() {
      const input = useRef<HTMLInputElement>(null);
      return (
        <>
          <input ref={input} aria-label="Rename" />
          <MenuButton
            label="More"
            items={[{ id: "rename", label: "Rename", onSelect: () => input.current?.focus() }]}
          />
        </>
      );
    }
    render(<Host />);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Rename" })).toHaveFocus();
  });

  it("keeps the trigger's ArrowDown from the workspace", async () => {
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    render(<MenuButton label="More" items={items()} />);
    screen.getByRole("button", { name: "More" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menu", { name: "More" })).toBeInTheDocument();
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });

  it("keeps arrow keys from the workspace when every item is disabled", async () => {
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    render(
      <MenuButton
        label="More"
        items={[{ id: "a", label: "Nothing yet", disabled: true, onSelect: () => {} }]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    // Fired inside the item list itself (where a still-focused item would send it).
    const list = screen.getByRole("menuitem", { name: "Nothing yet" }).parentElement!;
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) fireEvent.keyDown(list, { key });
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });

  it("shows a shortcut as shared key caps (Kbd's KeyChord), not a hand-rolled render", async () => {
    render(<MenuButton label="More" items={items()} />);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    const cloud = screen.getByRole("menuitem", { name: /Point cloud/ });
    expect([...cloud.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["Ctrl", "Shift", "P"]);
  });
});

describe("stacked focus traps", () => {
  function StackedHost() {
    const [open, setOpen] = useState(true);
    return (
      <Dialog open={open} title="Layer settings" onClose={() => setOpen(false)}>
        <MenuButton label="Add data" items={items()} />
      </Dialog>
    );
  }

  it("Esc inside a Menu opened from a Dialog closes only the menu, focus returns to its anchor, and the dialog's trap still holds", async () => {
    render(<StackedHost />);
    const dialog = screen.getByRole("dialog", { name: "Layer settings" });
    const menuButton = screen.getByRole("button", { name: "Add data" });

    await userEvent.click(menuButton);
    expect(screen.getByRole("menu", { name: "Add data" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Photos" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(menuButton).toHaveFocus();
    // The dialog itself never saw that Escape: it is still open.
    expect(screen.getByRole("dialog", { name: "Layer settings" })).toBe(dialog);

    // The dialog's focus trap still holds: Tab from the last focusable wraps to the first
    // (the header's Close button), it never leaves the dialog.
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    // The dialog's own Escape handler still fires once the menu is out of the way.
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
