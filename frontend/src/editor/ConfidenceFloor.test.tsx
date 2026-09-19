import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfidenceFloor } from "./ConfidenceFloor";

describe("ConfidenceFloor", () => {
  it("sets the floor in percent steps and says how many suggestions it hides", () => {
    const onChange = vi.fn();
    render(<ConfidenceFloor value={0.25} hidden={12} onChange={onChange} />);
    const slider = screen.getByLabelText("Hide suggestions below this confidence");
    expect(slider).toHaveValue("25");
    expect(screen.getByTestId("confidence-floor")).toHaveTextContent("below 25% · 12 hidden");
    fireEvent.change(slider, { target: { value: "60" } });
    expect(onChange).toHaveBeenCalledWith(0.6);
  });

  it("reads 'all shown' at zero", () => {
    render(<ConfidenceFloor value={0} hidden={0} onChange={() => {}} />);
    expect(screen.getByTestId("confidence-floor")).toHaveTextContent("all shown");
  });
});
