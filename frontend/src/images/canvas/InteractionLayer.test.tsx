import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleClasses, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { ensureBuiltInTools } from "@/images/tools";
import { InteractionLayer, insertVertex, moveVertex, removeVertex } from "./InteractionLayer";
import { makeDetail, makeShape } from "./testing";
import type { CommandContext } from "./commands";
import { lastProps } from "./testKonva";

vi.mock("react-konva", () => import("./testKonva"));

const st = () => useImagesWorkspace.getState();
const type = exampleClasses[0];
const box = makeShape({ id: "b", class_id: type.id });
const poly = makeShape({
  id: "p",
  class_id: type.id,
  shape: "polygon",
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
});
const ctx = (): CommandContext => ({
  api: fakeClient([]).api,
  projectId: PROJECT_ID,
  store: useImagesWorkspace,
  history: st().history,
});

beforeEach(() => {
  ensureBuiltInTools();
  st().reset();
  useImagesWorkspace.setState({ types: [type], tool: "select", activeTypeId: type.id });
  st().loadImage(makeDetail(), [box, poly], []);
});

describe("InteractionLayer (layer 4)", () => {
  it("attaches a Transformer to a single selected box in the select tool", () => {
    render(<InteractionLayer ctx={ctx()} />);
    expect(document.querySelector('[data-konva="transformer"]')).toBeNull();
    act(() => st().select(["b"]));
    expect(document.querySelector('[data-konva="transformer"]')).not.toBeNull();
    act(() => st().select(["b", "p"]));
    expect(document.querySelector('[data-konva="transformer"]')).toBeNull();
  });

  it("keeps a press on the Transformer's handles from reaching the stage (the select tool would deselect)", () => {
    render(<InteractionLayer ctx={ctx()} />);
    act(() => st().select(["b"]));
    const onMouseDown = lastProps.transformer.onMouseDown as (e: { cancelBubble: boolean }) => void;
    const e = { cancelBubble: false };
    onMouseDown(e);
    expect(e.cancelBubble).toBe(true);
  });

  it("lets the edge line catch presses only while Alt is held, so a plain press reaches the polygon", () => {
    render(<InteractionLayer ctx={ctx()} />);
    act(() => st().select(["p"]));
    const edges = () => document.querySelector('[data-name="polygon-edges"]');
    expect(edges()).toHaveAttribute("data-listening", "false");
    act(() => st().setHeld({ alt: true }));
    expect(edges()).toHaveAttribute("data-listening", "true");
  });

  it("shows one draggable handle per vertex of a selected polygon", () => {
    render(<InteractionLayer ctx={ctx()} />);
    act(() => st().select(["p"]));
    const handles = document.querySelectorAll('[data-name="vertex"]');
    expect(handles).toHaveLength(4);
    expect(handles[0]).toHaveAttribute("data-draggable", "true");
  });

  it("draws a static selection glow (no glow in reduced effects)", () => {
    render(<InteractionLayer ctx={ctx()} />);
    act(() => st().select(["b"]));
    expect(document.querySelector('[data-name="selection-glow"]')).toHaveAttribute("data-shadow", "10");
    document.documentElement.dataset.effects = "reduced";
    act(() => st().select(["p"]));
    expect(document.querySelector('[data-name="selection-glow"]')).toHaveAttribute("data-shadow", "0");
    delete document.documentElement.dataset.effects;
  });

  it("renders the active tool's draft and the overlay slot", () => {
    render(<InteractionLayer ctx={ctx()} overlay={<span data-testid="arrival" />} />);
    act(() => {
      st().setTool("length");
      st().setDraft({ kind: "length", a: { x: 0, y: 0 }, b: { x: 300, y: 400 } });
    });
    expect(document.querySelector('[data-konva="text"]')).toHaveAttribute("data-text", "1.00 m ± 28 mm");
    expect(document.querySelector('[data-testid="arrival"]')).not.toBeNull();
  });
});

describe("vertex edits", () => {
  const sq = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  it("inserts after the edge, removes down to three, moves one", () => {
    expect(insertVertex(sq, 0, { x: 5, y: 0 })[1]).toEqual({ x: 5, y: 0 });
    expect(removeVertex(sq, 1)).toHaveLength(3);
    expect(removeVertex(sq.slice(0, 3), 0)).toBeNull();
    expect(moveVertex(sq, 2, { x: 12, y: 12 })[2]).toEqual({ x: 12, y: 12 });
  });
});
