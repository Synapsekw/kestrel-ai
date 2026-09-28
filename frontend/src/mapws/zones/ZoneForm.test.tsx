import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ZoneForm } from "./ZoneForm";

describe("ZoneForm", () => {
  it("submits the trimmed name and the category", () => {
    const onSubmit = vi.fn();
    render(<ZoneForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "  Crane exclusion  " },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "exclusion" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save zone" }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Crane exclusion",
      category: "exclusion",
    });
  });

  it("asks for a name instead of saving a blank one", () => {
    const onSubmit = vi.fn();
    render(<ZoneForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save zone" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Name the zone");
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("defaults to General and cancels", () => {
    const onCancel = vi.fn();
    render(<ZoneForm onSubmit={vi.fn()} onCancel={onCancel} />);
    expect(screen.getByLabelText("Category")).toHaveValue("general");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
