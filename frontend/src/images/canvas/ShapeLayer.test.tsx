import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleClasses, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { ensureBuiltInTools } from "@/images/tools";
import { dragPatch, ShapeLayer } from "./ShapeLayer";
import { lastProps, renders } from "./testKonva";
import { gatedClient, makeDetail, makeMeasurement, makeShape } from "./testing";
import type { CommandContext } from "./commands";

vi.mock("react-konva", () => import("./testKonva"));

const st = () => useImagesWorkspace.getState();
const type = exampleClasses[0];
const box = makeShape({ id: "b", class_id: type.id, x: 100, y: 100, w: 40, h: 20, angle: 0 });
const poly = makeShape({
  id: "p",
  class_id: type.id,
  shape: "polygon",
  points: Array.from({ length: 40 }, (_, i) => [
    500 + 100 * Math.cos(i / 6.4),
    500 + 100 * Math.sin(i / 6.4),
  ]),
  x: 400,
  y: 400,
  w: 200,
  h: 200,
});
const point = makeShape({ id: "pt", class_id: type.id, shape: "point", x: 50, y: 60, w: 0, h: 0 });
const pending = makeShape({ id: "s", review_state: "unreviewed", confidence: 0.9 });
const rejected = makeShape({ id: "r", review_state: "rejected" });

const ctx = (): CommandContext => ({
  api: fakeClient([]).api,
  projectId: PROJECT_ID,
  store: useImagesWorkspace,
  history: st().history,
});

beforeEach(() => {
  ensureBuiltInTools();
  st().reset();
  useImagesWorkspace.setState({ types: [type], tool: "select" });
  st().loadImage(makeDetail(), [box, poly, point, pending, rejected], [makeMeasurement({ id: "m" })]);
  st().setView({ scale: 1, x: 0, y: 0 });
});

describe("ShapeLayer (layer 2)", () => {
  it("two polygon drags ending before the first save resolves move it by both offsets", async () => {
    const tri = makeShape({
      id: "tri",
      class_id: type.id,
      shape: "polygon",
      points: [
        [10, 10],
        [60, 10],
        [60, 50],
      ],
      x: 10,
      y: 10,
      w: 50,
      h: 40,
    });
    st().loadImage(makeDetail(), [tri], []);
    const { api, requests, gate } = gatedClient([
      {
        method: "PATCH",
        path: /\/boxes\/tri$/,
        body: (req) => ({ ...st().boxes.tri, ...(req.body as object) }),
      },
    ]);
    render(
      <ShapeLayer ctx={{ api, projectId: PROJECT_ID, store: useImagesWorkspace, history: st().history }} />,
    );
    // The Konva node keeps its drag offset until the save lands and resync puts it back at 0.
    let at = { x: 0, y: 0 };
    const node = {
      x: () => at.x,
      y: () => at.y,
      width: () => 0,
      height: () => 0,
      scaleX: () => 1,
      scaleY: () => 1,
      rotation: () => 0,
      position: (p: { x: number; y: number }) => void (at = p),
      getLayer: () => null,
    };
    const dragEnd = lastProps.line.onDragEnd as (e: unknown) => void;
    at = { x: 5, y: 0 };
    act(() => dragEnd({ target: node, cancelBubble: false }));
    at = { x: 12, y: 0 }; // the second drag starts from the first one's offset and adds 7
    act(() => dragEnd({ target: node, cancelBubble: false }));
    await waitFor(() => expect(gate.arrived).toBe(1));
    gate.release();
    await waitFor(() => expect(gate.arrived).toBe(2));
    gate.release();
    await waitFor(() => expect(requests).toHaveLength(2));
    await waitFor(() => expect(st().pending).toBe(0));
    expect((requests[1].body as { points: number[][] }).points[0]).toEqual([22, 10]);
    expect(st().boxes.tri.points?.[0]).toEqual([22, 10]);
  });

  it("stops listening at the layer during a gesture without re-rendering the nodes (m1)", () => {
    render(<ShapeLayer ctx={ctx()} />);
    const before = renders.rect ?? 0;
    act(() => st().setInteracting(true));
    expect(document.querySelector('[data-name="annotations"]')).toHaveAttribute("data-listening", "false");
    act(() => st().setInteracting(false));
    expect(renders.rect ?? 0).toBe(before);
  });

  it("draws accepted shapes only: a centre-pivoted rect, a closed line, a circle", () => {
    render(<ShapeLayer ctx={ctx()} />);
    expect(document.querySelector('[data-id="shape-b"]')).toHaveAttribute("data-x", "120");
    expect(document.querySelector('[data-id="shape-p"]')).toHaveAttribute("data-closed", "true");
    expect(document.querySelector('[data-id="shape-pt"]')?.getAttribute("data-konva")).toBe("circle");
    expect(document.querySelector('[data-id="shape-s"]')).toBeNull();
    expect(document.querySelector('[data-id="shape-r"]')).toBeNull();
  });

  it("is named, and hidden with Shift+H", () => {
    render(<ShapeLayer ctx={ctx()} />);
    const layer = document.querySelector('[data-name="annotations"]')!;
    expect(layer).toHaveAttribute("data-visible", "true");
    act(() => st().toggleAnnotations());
    expect(document.querySelector('[data-name="annotations"]')).toHaveAttribute("data-visible", "false");
  });

  it("stops listening while the view moves and while a drawing tool is active", () => {
    render(<ShapeLayer ctx={ctx()} />);
    act(() => st().setInteracting(true));
    expect(document.querySelector('[data-name="annotations"]')).toHaveAttribute("data-listening", "false");
    act(() => {
      st().setInteracting(false);
      st().setTool("polygon");
    });
    expect(document.querySelector('[data-name="annotations"]')).toHaveAttribute("data-listening", "false");
  });

  it("simplifies polygons by zoom bucket", () => {
    render(<ShapeLayer ctx={ctx()} />);
    const near = JSON.parse(
      document.querySelector('[data-id="shape-p"]')!.getAttribute("data-points")!,
    ).length;
    act(() => st().setView({ scale: 0.05, x: 0, y: 0 }));
    const far = JSON.parse(
      document.querySelector('[data-id="shape-p"]')!.getAttribute("data-points")!,
    ).length;
    expect(far).toBeLessThan(near);
  });

  it("labels only the selected, the hovered, and shapes at least 48 screen px tall", () => {
    render(<ShapeLayer ctx={ctx()} />);
    const labels = () =>
      [...document.querySelectorAll('[data-konva="text"]')].map((n) => n.getAttribute("data-name"));
    expect(labels()).toEqual(["label p", "measurement-label m"]); // the polygon is 200 px tall
    act(() => st().select(["b"]));
    expect(labels()).toContain("label b");
  });

  it("does not re-render shape nodes on a pan, nor on a zoom inside the same bucket", () => {
    render(<ShapeLayer ctx={ctx()} />);
    // The box is the only rect. A pan does not re-render the layer at all; a zoom inside bucket 0
    // re-renders the layer but not the memoised ShapeNode (points and labels may, and are not counted).
    const before = renders.rect ?? 0;
    act(() => st().setView({ scale: 1, x: -300, y: -200 }));
    act(() => st().setView({ scale: 1.05, x: -300, y: -200 }));
    expect(renders.rect ?? 0).toBe(before);
  });

  it("labels a measurement with px when the image has no scale", () => {
    const camera = {
      ...makeDetail().camera,
      gsd_mm: null,
      distance_m: null,
      distance_sigma_m: null,
      distance_source: "none" as const,
    };
    st().setImage(makeDetail({ camera }));
    render(<ShapeLayer ctx={ctx()} />);
    expect(document.querySelector('[data-name="measurement-label m"]')).toHaveAttribute(
      "data-text",
      "500 px",
    );
  });
});

describe("dragPatch", () => {
  const image = { width: 4000, height: 3000 };
  const nodeAt = (x: number, y: number, extra: Partial<Record<string, number>> = {}) => ({
    x: () => x,
    y: () => y,
    width: () => extra.width ?? 40,
    height: () => extra.height ?? 20,
    scaleX: () => extra.scaleX ?? 1,
    scaleY: () => extra.scaleY ?? 1,
    rotation: () => extra.rotation ?? 0,
  });

  it("turns a centre-pivoted rect into the unrotated top-left, scaled and rotated", () => {
    expect(dragPatch(box, nodeAt(220, 210, { scaleX: 2, rotation: 30 }), image)).toEqual({
      kind: "rect",
      rect: { x: 180, y: 200, w: 80, h: 20, angle: 30 },
    });
  });

  it("translates polygon points by the node offset", () => {
    const p = dragPatch(poly, nodeAt(10, -5), image);
    expect(p.kind === "points" && p.points[0]).toEqual({
      x: poly.points![0][0] + 10,
      y: poly.points![0][1] - 5,
    });
  });

  it("clamps a point into the image", () => {
    expect(dragPatch(point, nodeAt(-4, 3100), image)).toEqual({ kind: "point", at: { x: 0, y: 3000 } });
  });
});
