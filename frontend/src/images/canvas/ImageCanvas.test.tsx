import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Box } from "@contract/client";
import type { BoxWriteResult } from "@/api/shapes";
import { ApiContext } from "@/api/client";
import { exampleClasses, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { createIdleMarker, ImageCanvas, type ImageCanvasHandle } from "./ImageCanvas";
import { useImagesKeymap } from "@/images/workspace/keymap";
import type { CommandContext } from "./commands";
import { fakeStage, renders, stageProps } from "./testKonva";
import { useCanvasKeyHandlers } from "./useCanvasKeys";
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
    expect(onShapeCreated).toHaveBeenCalledTimes(1);
    expect(requests.at(-1)?.body).toMatchObject({
      class_id: "t1",
      shape: "box",
      x: 100,
      y: 100,
      w: 200,
      h: 150,
    });
  });

  it("reports a polygon closed with Enter once (I2)", async () => {
    const onShapeCreated = vi.fn();
    const { requests } = mount({ onShapeCreated });
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/images\/[^/]+\/boxes$/,
        status: 201,
        body: (req) => makeWritten({ ...(req.body as Partial<Box>), id: "enter" }),
      },
    ]);
    const ctx: CommandContext = {
      api,
      projectId: PROJECT_ID,
      store: useImagesWorkspace,
      history: st().history,
    };
    renderHook(() => useImagesKeymap([useCanvasKeyHandlers(ctx)]));
    act(() => {
      st().setTool("polygon");
      st().setDraft({
        kind: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 50 },
        ],
        cursor: null,
        pressed: false,
        lastScreen: null,
      });
    });
    act(() => void fireEvent.keyDown(window, { key: "Enter" }));
    await waitFor(() =>
      expect(onShapeCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "enter" })),
    );
    expect(onShapeCreated).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(0); // the key handlers' own client made the request
  });

  it("re-picks the drawing tool's type when the catalogue changes (I5)", () => {
    useImagesWorkspace.setState({ tool: "box", activeTypeId: "other-project-type" });
    mount();
    expect(st().activeTypeId).toBe("t1");
  });

  it("does not re-render the shape and interaction layers on a pan frame (m2)", () => {
    mount();
    const before = renders.layer ?? 0;
    act(() => st().setView({ ...st().view, x: st().view.x + 10 }));
    // Only the image and suggestion layers, which ImageCanvas renders itself.
    expect((renders.layer ?? 0) - before).toBe(2);
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

  it("counts the delay from the end of the input's own work, not its start (a slow notch)", async () => {
    // CI run 36439794911: on a slow machine one wheel notch's handler (the zoom and its render)
    // took over 120 ms, so a delay started at mark() was already due when the handler returned and
    // ran before the next notch - the layers listened again and rebuilt the hit graph per notch.
    // Real timers: a fake clock cannot hold its timers back through a blocking handler.
    const idle = createIdleMarker(useImagesWorkspace);
    const seen: boolean[] = [];
    const unsub = useImagesWorkspace.subscribe((s) => seen.push(s.interacting));
    const nextNotch = new Promise<void>((resolve) => {
      idle.mark();
      const end = performance.now() + 150;
      while (performance.now() < end); // the handler's own work: no timer can run inside it
      setTimeout(() => {
        idle.mark(); // the next notch, 16 ms after the first was handled
        resolve();
      }, 16);
    });
    await nextNotch;
    expect(seen).not.toContain(false);
    await waitFor(() => expect(st().interacting).toBe(false));
    unsub();
    idle.dispose();
  });

  it("clears `interacting` when disposed with a timer pending (T10)", () => {
    vi.useFakeTimers();
    const idle = createIdleMarker(useImagesWorkspace);
    idle.mark();
    idle.dispose();
    expect(st().interacting).toBe(false);
  });
});
