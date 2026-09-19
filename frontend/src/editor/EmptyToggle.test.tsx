import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { exampleImage } from "@/test/fixtures";
import { EmptyToggle } from "./EmptyToggle";

describe("EmptyToggle", () => {
  it("offers to mark an unmarked image and calls onToggle on click", () => {
    const onToggle = vi.fn();
    render(<EmptyToggle image={exampleImage} hasGroundTruth={false} busy={false} onToggle={onToggle} />);
    const button = screen.getByRole("button", { name: /No machinery/ });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalled();
  });

  it("shows the marked state once the image is marked empty", () => {
    render(
      <EmptyToggle
        image={{ ...exampleImage, marked_empty: true }}
        hasGroundTruth={false}
        busy={false}
        onToggle={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: /Marked empty/ });
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("is disabled with an explanatory title while the image has ground truth", () => {
    render(<EmptyToggle image={exampleImage} hasGroundTruth={true} busy={false} onToggle={() => {}} />);
    const button = screen.getByRole("button", { name: /No machinery/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Delete or reject the boxes first");
  });

  it("is disabled while a request is in flight", () => {
    render(<EmptyToggle image={exampleImage} hasGroundTruth={false} busy={true} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: /No machinery/ })).toBeDisabled();
  });

  it("is disabled with no image loaded yet", () => {
    render(<EmptyToggle image={null} hasGroundTruth={false} busy={false} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: /No machinery/ })).toBeDisabled();
  });
});
