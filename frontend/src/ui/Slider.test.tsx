import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Slider, snapValue, stepValue } from "./Slider";

afterEach(() => vi.restoreAllMocks());

describe("snapValue and stepValue", () => {
  it("snaps to the step grid without float noise and clamps", () => {
    expect(snapValue(0.34, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
    expect(snapValue(0.1 + 0.2, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
    expect(snapValue(7, { min: 0, max: 5, step: 1 })).toBe(5);
    expect(snapValue(Number.NaN, { min: 2, max: 9, step: 1 })).toBe(2);
  });

  it("snaps to the nearest stop and ignores stops outside the range", () => {
    expect(snapValue(1.4, { min: 0, max: 4, stops: [0.5, 1, 2, 4] })).toBe(1);
    expect(snapValue(3, { min: 0, max: 10, stops: [20, -1] })).toBe(3);
  });

  it("steps through stops and along the grid", () => {
    const stops = { min: 0, max: 4, stops: [0.5, 1, 2, 4] };
    expect(stepValue(1, 1, false, stops)).toBe(2);
    expect(stepValue(4, 1, false, stops)).toBe(4);
    expect(stepValue(2, -1, true, stops)).toBe(0.5);
    expect(stepValue(50, 1, true, { min: 0, max: 100, step: 1 })).toBe(60);
  });
});

function Host(props: { stops?: number[]; onChange?: (v: number) => void }) {
  const [value, setValue] = useState(1);
  return (
    <Slider
      label="Point size"
      min={0}
      max={4}
      step={props.stops ? undefined : 0.5}
      stops={props.stops}
      value={value}
      format={(v) => `${v} px`}
      onChange={(v) => {
        setValue(v);
        props.onChange?.(v);
      }}
    />
  );
}

describe("Slider", () => {
  it("is an accessible slider that steps with the keys and shows its value in mono", () => {
    render(<Host />);
    const slider = screen.getByRole("slider", { name: "Point size" });
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    expect(slider).toHaveAttribute("aria-valuetext", "1 px");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "1.5");
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuenow", "4");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("0 px").className).toContain("font-mono");
  });

  it("walks discrete stops", () => {
    render(<Host stops={[0.5, 1, 2, 4]} />);
    const slider = screen.getByRole("slider", { name: "Point size" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "2");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "4");
  });

  it("maps a pointer press on the track to a value", () => {
    const onChange = vi.fn();
    render(<Slider label="Opacity" min={0} max={100} step={1} value={20} onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "Opacity" });
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 200,
      top: 0,
      height: 20,
    } as DOMRect);
    act(() => {
      slider.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 150 }));
    });
    expect(onChange).toHaveBeenCalledWith(75);
  });

  it("keeps its keys from the workspace shortcuts", () => {
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    render(<Host />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Point size" }), { key: "ArrowRight" });
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });

  it("does nothing while disabled", () => {
    const onChange = vi.fn();
    render(<Slider label="Blend" min={0} max={1} step={0.1} value={0.5} onChange={onChange} disabled />);
    const slider = screen.getByRole("slider", { name: "Blend" });
    expect(slider).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
