import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_ID } from "@/test/fixtures";
import type { Placement } from "../layers/placement";
import { makeStores, renderInWorkspace } from "../test/harness";
import { UTM33, survey } from "../test/fixtures";
import { layerFeed, mapLayer } from "../test/rasterFixtures";
import { CompareStage, ghostOffset, sideLabel } from "./CompareStage";
import { useStageSize } from "./stageSize";

vi.mock("../data/useWorkspaceLayers", async (importOriginal) => {
  const { layerFeed } = await import("../test/rasterFixtures");
  return {
    ...(await importOriginal<typeof import("../data/useWorkspaceLayers")>()),
    useWorkspaceLayers: () => layerFeed,
  };
});

const rect = (left: number, width: number, height = 400) =>
  ({
    left,
    top: 0,
    width,
    height,
    right: left + width,
    bottom: height,
    x: left,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
function setup(mode: "swipe" | "side" | "single" = "swipe") {
  Object.assign(layerFeed, {
    loading: false,
    layers: [
      mapLayer("aug", "2026-08-14", { footprint_site: [0, 0, 100, 100] }),
      mapLayer("sep", "2026-09-14", { footprint_site: [5000, 5000, 5100, 5100] }),
    ],
  });
  const stores = makeStores({
    surveys: [survey("2026-08-14"), survey("2026-09-14")],
  });
  act(() => stores.workspace.getState().setMode(mode));
  renderInWorkspace(<CompareStage projectId={PROJECT_ID} frame={UTM33} />, {
    stores,
  });
  const root = screen.getByTestId("compare-stage");
  root.getBoundingClientRect = () => rect(0, 1000);
  return stores.workspace;
}

describe("pure helpers", () => {
  it("labels a side by its topmost dated group (W2-6)", () => {
    const p = (side: string, group: string) =>
      ({ side, row: { group, date: "2026-08-14" } }) as unknown as Placement;
    expect(sideLabel([p("left", "base")], "left")).toBe("Ortho");
    expect(sideLabel([p("right", "elevation")], "right")).toBe("Elevation");
    expect(sideLabel([p("both", "elevation")], "left")).toBe("No data");
  });

  it("puts the ghost at the same offset in the other half (W2-8)", () => {
    expect(ghostOffset(130, 40, rect(100, 1000))).toEqual({ x: 530, y: 40 });
    expect(ghostOffset(630, 40, rect(100, 1000))).toEqual({ x: 30, y: 40 });
    expect(ghostOffset(50, 40, rect(100, 1000))).toBeNull();
  });
});

describe("CompareStage", () => {
  beforeEach(() => useStageSize.setState({ size: null }));

  it("Swipe: the handle drags the divider through W1's store, clamped to 2–98 %", () => {
    const ws = setup("swipe");
    const handle = screen.getByTestId("swipe-handle");
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 700, pointerId: 1 });
    expect(ws.getState().swipe).toBe(70);
    fireEvent.pointerMove(handle, { clientX: -40, pointerId: 1 });
    expect(ws.getState().swipe).toBe(2);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });
    expect(ws.getState().swipe).toBe(2); // released: moves no longer drag
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(ws.getState().swipe).toBe(12);
    fireEvent.keyDown(handle, { key: "End" });
    expect(ws.getState().swipe).toBe(98);
    expect(handle).toHaveAttribute("aria-valuetext", "98%");
    expect(screen.getByText("14 Aug")).toBeInTheDocument();
  });

  it("frame budget: a 60-move drag writes the store once per move and moves the line", () => {
    const ws = setup("swipe");
    const handle = screen.getByTestId("swipe-handle");
    handle.setPointerCapture = vi.fn();
    let writes = 0;
    const unsubscribe = ws.subscribe((s, prev) => {
      if (s.swipe !== prev.swipe) writes++;
    });
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    for (let i = 1; i <= 60; i++) fireEvent.pointerMove(handle, { clientX: 500 + i * 5, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    unsubscribe();
    expect(writes).toBe(60);
    expect(screen.getByTestId("swipe-line").style.left).toBe("80%");
  });

  it("Side-by-side: labels both sides and mirrors the cursor as a ghost", async () => {
    setup("side");
    expect(await screen.findByText("◀ 14 Aug 2026 · Ortho")).toBeInTheDocument();
    expect(screen.getByText("14 Sep 2026 · Ortho ▶")).toBeInTheDocument();
    act(() => void fireEvent.pointerMove(window, { clientX: 130, clientY: 40 }));
    expect(screen.getByTestId("ghost-crosshair").style.transform).toBe("translate(630px, 40px)");
    expect(screen.queryByTestId("swipe-handle")).toBeNull();
  });

  it("shows 'No 14 Sep data here' on the side whose date has nothing in view (M §14)", async () => {
    const ws = setup("side");
    await screen.findByText("◀ 14 Aug 2026 · Ortho");
    act(() => {
      useStageSize.setState({ size: [1000, 400] });
      ws.getState().setViewInfo({
        center: [50, 50],
        resolution: 0.2,
        rotation: 0,
      });
    });
    expect(screen.getByText("No 14 Sep data here")).toBeInTheDocument();
    expect(screen.queryByText("No 14 Aug data here")).toBeNull();
  });

  it("renders only the size probe in Single", () => {
    setup("single");
    expect(screen.queryByTestId("swipe-handle")).toBeNull();
    expect(screen.queryByText(/data here/)).toBeNull();
  });
});
