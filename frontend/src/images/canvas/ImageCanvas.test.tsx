import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Box } from "@contract/client";
import type { BoxWriteResult } from "@/api/shapes";
import { ApiContext } from "@/api/client";
import { exampleClasses, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { createIdleMarker, ImageCanvas, type ImageCanvasHandle } from "./ImageCanvas";
import { fakeStage, stageProps } from "./testKonva";
import { makeDetail, makeShape, makeWritten } from "./testing";

vi.mock("react-konva", () => import("./testKonva"));
vi.mock("./useTwoLevelImage", () => ({
  useTwoLevelImage: () => ({ bitmap: null, level: null, imageId: null }),
}));

const st = () => useImagesWorkspace.getState();
const type = { ...exampleClasses[0], id: "t1" };

function mount(
  extra: { suggestions?: ReactNode; overlay?: ReactNode; onShapeCreated?: (b: BoxWriteResult) => void } = {},
) {
  const { api, requests } = fakeClient([
    {
      method: "POST",
      path: /\/images\/[^/]+\/boxes$/,
      status: 201,
      body: (req) => makeWritten({ ...(req.body as Partial<Box>), id: "new" }),
    },
  ]);
  const ref = createRef<ImageCanvasHandle>();
  render(
    <ApiContext.Provider
      value={{
        client: api,
        info: { baseUrl: "http://fake", token: "t", mode: "mock", logPath: null },
        health: {} as never,
      }}
    >
      <ImageCanvas
        ref={ref}
        projectId={PROJECT_ID}
        types={[type]}
        imageUrl={(id, m) => `/${id}?${m}`}
        {...extra}
      >
        <div data-testid="floating" />
      </ImageCanvas>
    </ApiContext.Provider>,
  );
  act(() => st().setViewport({ width: 1000, height: 800 }));
  return { ref, requests };
}

const press = (button = 0) => ({
  evt: { button, shiftKey: false, altKey: false, preventDefault: () => undefined },
  target: fakeStage,
});

beforeEach(() => {
  st().reset();
  useImagesWorkspace.setState({ tool: "select", activeTypeId: "t1" });
  st().loadImage(
    makeDetail(),
    [makeShape({ id: "a" }), makeShape({ id: "r", review_state: "rejected" })],
    [],
  );
});
afterEach(() => vi.useRealTimers());

describe("ImageCanvas", () => {
  it("stacks the four named layers and renders the slots", () => {
    mount({ suggestions: <span data-testid="sugg" />, overlay: <span data-testid="marker" /> });
    const names = [...document.querySelectorAll('[data-konva="layer"]')].map((n) =>
      n.getAttribute("data-name"),
    );
    expect(names).toEqual(["image", "annotations", "suggestions", "interaction"]);
    expect(screen.getByTestId("sugg").closest('[data-name="suggestions"]')).not.toBeNull();
    expect(screen.getByTestId("marker").closest('[data-name="interaction"]')).not.toBeNull();
    expect(screen.getByTestId("floating")).toBeInTheDocument();
  });

  it("carries the e2e hooks", () => {
    mount();
    const host = screen.getByTestId("image-canvas");
    expect(host).toHaveAttribute("data-image", "4000x3000");
    expect(host).toHaveAttribute("data-tool", "select");
    expect(host).toHaveAttribute("data-shape-count", "1"); // the rejected one is not counted
    expect(host.getAttribute("data-view-scale")).toMatch(/^\d+\.\d{4}$/);
  });

  it("routes a stage press to the active tool and reports the created shape", async () => {
    const onShapeCreated = vi.fn();
    const { requests } = mount({ onShapeCreated });
    act(() => st().setTool("box"));
    st().setView({ scale: 1, x: 0, y: 0 });
    fakeStage.pointer = { x: 100, y: 100 };
    act(() => (stageProps.current!.onMouseDown as (e: unknown) => void)(press()));
    fakeStage.pointer = { x: 300, y: 250 };
    act(() => (stageProps.current!.onMouseMove as (e: unknown) => void)(press()));
    await act(async () => (stageProps.current!.onMouseUp as (e: unknown) => void)(press()));
    await waitFor(() => expect(onShapeCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "new" })));
    expect(requests.at(-1)?.body).toMatchObject({
      class_id: "t1",
      shape: "box",
      x: 100,
      y: 100,
      w: 200,
      h: 150,
    });
  });

  it("ignores a press while Space pans", () => {
    mount();
    act(() => {
      st().setTool("box");
      st().setHeld({ space: true });
    });
    expect(stageProps.current!.draggable).toBe(true);
    act(() => (stageProps.current!.onMouseDown as (e: unknown) => void)(press()));
    expect(st().draft).toBeNull();
  });

  it("stops the annotation and suggestion layers listening during a wheel zoom, for 120 ms", () => {
    vi.useFakeTimers();
    mount();
    fakeStage.pointer = { x: 500, y: 400 };
    act(() =>
      (stageProps.current!.onWheel as (e: unknown) => void)({
        evt: { deltaY: -100, preventDefault: () => undefined },
      }),
    );
    expect(document.querySelector('[data-name="annotations"]')).toHaveAttribute("data-listening", "false");
    expect(document.querySelector('[data-name="suggestions"]')).toHaveAttribute("data-listening", "false");
    act(() => vi.advanceTimersByTime(120));
    expect(document.querySelector('[data-name="suggestions"]')).toHaveAttribute("data-listening", "true");
  });

  it("pans with the middle button from any tool", () => {
    mount();
    const x0 = st().view.x;
    const host = screen.getByTestId("image-canvas");
    fireEvent.mouseDown(host, { button: 1, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 60, clientY: 30 });
    fireEvent.mouseUp(window);
    expect(st().view.x).toBeCloseTo(x0 + 50);
  });

  it("centres on a point through its handle (FW's arrival)", () => {
    const { ref } = mount();
    act(() => ref.current!.centreOn({ x: 2000, y: 1500 }, { radiusPx: 24 }));
    const v = st().view;
    expect(v.x + 2000 * v.scale).toBeCloseTo(500);
  });
});

describe("createIdleMarker", () => {
  it("clears `interacting` 120 ms after the last mark", () => {
    vi.useFakeTimers();
    const idle = createIdleMarker(useImagesWorkspace);
    idle.mark();
    vi.advanceTimersByTime(100);
    idle.mark();
    vi.advanceTimersByTime(100);
    expect(st().interacting).toBe(true);
    vi.advanceTimersByTime(20);
    expect(st().interacting).toBe(false);
  });
});
