import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton, buttonClass } from "./Button";

describe("Button", () => {
  it("loading disables the button, marks it busy and keeps its label", () => {
    render(<Button loading>Save</Button>);
    const b = screen.getByRole("button", { name: /save/i });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
  });

  it("clicks fire when enabled and not when disabled", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Plain</Button>);
    expect(screen.getByRole("button", { name: "Plain" })).toHaveAttribute("type", "button");
  });

  it("IconButton takes its accessible name from label", () => {
    render(<IconButton icon="trash" label="Delete row" />);
    expect(screen.getByRole("button", { name: "Delete row" })).toBeInTheDocument();
  });

  it("primary carries the brand gradient and glow; every variant is a control-radius box", () => {
    render(
      <>
        <Button variant="primary">P</Button>
        <Button variant="secondary">S</Button>
        <Button variant="ghost">G</Button>
        <Button variant="danger">D</Button>
      </>,
    );
    const primary = screen.getByRole("button", { name: "P" });
    expect(primary.className).toContain("bg-grad-primary");
    expect(primary.className).toContain("shadow-glow");
    for (const name of ["P", "S", "G", "D"]) {
      expect(screen.getByRole("button", { name }).className).toContain("rounded-control");
    }
    expect(screen.getByRole("button", { name: "D" }).className).toContain("text-danger");
  });

  it("buttonClass still styles links as buttons", () => {
    expect(buttonClass("primary", "sm", "extra")).toMatch(/h-7.*extra/);
  });
});
