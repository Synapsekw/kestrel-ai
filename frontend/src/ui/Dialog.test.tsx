import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open it</Button>
      <Dialog
        open={open}
        title="Import images"
        onClose={() => setOpen(false)}
        footer={<Button>Start</Button>}
      >
        <input aria-label="Folder" />
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("opens with focus inside, closes on Escape and returns focus to the opener", async () => {
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Open it" });
    await userEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Import images" });
    expect(dialog).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("Tab cycles inside the dialog", async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole("button", { name: "Open it" }));
    const close = screen.getByRole("button", { name: "Close" });
    const folder = screen.getByLabelText("Folder");
    const start = screen.getByRole("button", { name: "Start" });
    expect(close).toHaveFocus();
    await userEvent.tab();
    expect(folder).toHaveFocus();
    await userEvent.tab();
    expect(start).toHaveFocus();
    await userEvent.tab();
    expect(close).toHaveFocus();
  });
});

function Vanishing() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {!open && <Button onClick={() => setOpen(true)}>Open</Button>}
      <Dialog open={open} title="Details" onClose={() => setOpen(false)}>
        <p>Body</p>
      </Dialog>
    </>
  );
}

describe("Dialog (Aero glass)", () => {
  it("is a floating glass panel", async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect(screen.getByRole("dialog", { name: "Import images" })).toHaveAttribute("data-glass", "float");
  });

  it("closes cleanly when its opener has left the page", async () => {
    render(<Vanishing />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog", { name: "Details" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
