import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHoldKey } from "./useHoldKey";

function Harness({ onChange, enabled = true }: { onChange: (h: boolean) => void; enabled?: boolean }) {
  useHoldKey("Space", onChange, enabled, '[data-testid="zone"]');
  return (
    <>
      <input aria-label="note" />
      <button type="button">Press</button>
      <div data-testid="zone" tabIndex={-1} />
      <div aria-modal="true" role="dialog">
        <button type="button">Merge</button>
      </div>
    </>
  );
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

  it("leaves Space to a focused button and to anything in a modal dialog", () => {
    const onChange = vi.fn();
    const { getByRole } = render(<Harness onChange={onChange} />);
    for (const name of ["Press", "Merge"]) {
      const allowed = fireEvent.keyDown(getByRole("button", { name }), { key: " " });
      expect(allowed).toBe(true); // not default-prevented: the button still presses
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("takes Space inside its zone and default-prevents it there", () => {
    const onChange = vi.fn();
    const { getByTestId } = render(<Harness onChange={onChange} />);
    expect(fireEvent.keyDown(getByTestId("zone"), { key: " " })).toBe(false);
    fireEvent.keyUp(getByTestId("zone"), { key: " " });
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it("lets go when it is disabled or unmounted mid-hold", () => {
    const onChange = vi.fn();
    const { rerender, unmount } = render(<Harness onChange={onChange} />);
    fireEvent.keyDown(window, { key: " " });
    rerender(<Harness onChange={onChange} enabled={false} />);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    rerender(<Harness onChange={onChange} />);
    fireEvent.keyDown(window, { key: " " });
    unmount();
    expect(onChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  });
});
