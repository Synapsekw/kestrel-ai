import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { FeatureContext } from "@/clouds/workspace/types";
import { useReportViewsFeature } from "@/clouds/workspace/features/reportViews";
import { SavingViewsHint, useCaptureMissingItem } from "./SavingViewsHint";
import { useViewStore } from "./viewStore";

const actions = { enqueue: vi.fn(), captureMissing: vi.fn(), cancelMissing: vi.fn() };

describe("Saving views progress", () => {
  beforeEach(() => {
    Object.values(actions).forEach((f) => f.mockReset());
    useViewStore.getState().reset("p1", "c1");
    useViewStore.getState().setActions(actions);
  });

  it("renders nothing when no bulk run is going", () => {
    const { container } = render(<SavingViewsHint />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says it is listing, then counts with a bar, and cancels", () => {
    act(() => useViewStore.getState().setBulk({ done: 0, total: 0 }));
    render(<SavingViewsHint />);
    expect(screen.getByText("Looking for missing views…")).toBeInTheDocument();
    act(() => useViewStore.getState().setBulk({ done: 12, total: 40 }));
    expect(screen.getByText("Saving views 12 / 40")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Saving report views" })).toHaveAttribute(
      "aria-valuenow",
      "30",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.cancelMissing).toHaveBeenCalledTimes(1);
  });

  it("gives the Findings menu an item that is disabled while running or without a viewer", () => {
    const { result } = renderHook(() => useCaptureMissingItem());
    expect(result.current).toMatchObject({
      id: "capture-missing-views",
      label: "Capture missing views",
      disabled: true,
    });
    act(() => useViewStore.getState().setReady(true));
    expect(result.current.disabled).toBe(false);
    result.current.onSelect();
    expect(actions.captureMissing).toHaveBeenCalledTimes(1);
    act(() => useViewStore.getState().setBulk({ done: 0, total: 3 }));
    expect(result.current.disabled).toBe(true);
  });

  it("gives the workspace the menu item, and hint progress only while a bulk run is going", () => {
    const { result } = renderHook(() => useReportViewsFeature({} as FeatureContext));
    expect(result.current.name).toBe("reportViews");
    expect(result.current.findingsMenu?.map((m) => m.label)).toEqual(["Capture missing views"]);
    expect(result.current.hintProgress).toBeUndefined(); // anything else keeps the hint bar from fading
    act(() => useViewStore.getState().setBulk({ done: 1, total: 3 }));
    expect(result.current.hintProgress).toBeDefined();
    act(() => useViewStore.getState().setBulk(null));
    expect(result.current.hintProgress).toBeUndefined();
  });
});
