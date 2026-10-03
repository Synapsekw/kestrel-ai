import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHoldKey } from "./useHoldKey";

function Harness({ onChange }: { onChange: (h: boolean) => void }) {
  useHoldKey("Space", onChange);
  return <input aria-label="note" />;
}

describe("useHoldKey", () => {
  it("reports press and release once each, ignoring key repeat", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyDown(window, { key: " ", repeat: true });
    fireEvent.keyUp(window, { key: " " });
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it("does not fire while typing and lets go when the window loses focus", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<Harness onChange={onChange} />);
    fireEvent.keyDown(getByLabelText("note"), { key: " " });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: " " });
    fireEvent.blur(window);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });
});
