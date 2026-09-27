import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HintBar } from "./HintBar";
import { ENTRY, HINT_FADE_MS, type CloudToolId } from "./tools";

const bar = (id: CloudToolId) => (
  <HintBar entry={ENTRY[id]} tool={null} progress={null} onCancel={() => {}} />
);
const faded = () => screen.getByTestId("cloud-hintbar").classList.contains("opacity-0");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the hint bar's fade (spec §6: nav tools fade 2.4 s after arming)", () => {
  it("fades Orbit, and shows it again after a round trip through Distance", () => {
    const { rerender } = render(bar("orbit"));
    expect(faded()).toBe(false);
    act(() => vi.advanceTimersByTime(HINT_FADE_MS));
    expect(faded()).toBe(true);

    rerender(bar("distance"));
    expect(faded()).toBe(false);
    act(() => vi.advanceTimersByTime(HINT_FADE_MS));
    expect(faded()).toBe(false); // a picking tool never fades

    rerender(bar("orbit"));
    expect(faded()).toBe(false);
    act(() => vi.advanceTimersByTime(HINT_FADE_MS - 1));
    expect(faded()).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(faded()).toBe(true);
  });
});

describe("the hint bar's Save and Cancel", () => {
  it("show the keymap's commit and cancel keys", () => {
    render(
      <HintBar
        entry={ENTRY.area}
        tool={{ id: "area", picks: true, onCommit: () => {}, commitLabel: "Save area" }}
        progress={null}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Save area/ }).querySelector("kbd")).toHaveTextContent("Enter");
    expect(screen.getByRole("button", { name: /Cancel/ }).querySelector("kbd")).toHaveTextContent("Esc");
  });
});
