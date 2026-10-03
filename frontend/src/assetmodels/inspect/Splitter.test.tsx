import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Splitter } from "./Splitter";

function Harness({ onKeyUp = vi.fn() }: { onKeyUp?: () => void }) {
  const [v, setV] = useState(50);
  return (
    <div onKeyDown={onKeyUp}>
      <Splitter value={v} onChange={setV} />
    </div>
  );
}

describe("Splitter", () => {
  it("is a keyboard separator with its value", () => {
    const outer = vi.fn();
    render(<Harness onKeyUp={outer} />);
    const sep = screen.getByRole("separator", { name: /resize the model and photo panes/i });
    expect(sep).toHaveAttribute("aria-orientation", "vertical");
    expect(sep).toHaveAttribute("aria-valuemin", "22");
    expect(sep).toHaveAttribute("aria-valuemax", "75");
    sep.focus();
    fireEvent.keyDown(sep, { key: "End" });
    expect(sep).toHaveAttribute("aria-valuenow", "75");
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(sep).toHaveAttribute("aria-valuenow", "73");
    // the arrows move the splitter, never the sighting behind it
    expect(outer).not.toHaveBeenCalled();
  });
});
