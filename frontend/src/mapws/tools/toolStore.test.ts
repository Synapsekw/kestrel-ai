import { describe, expect, it } from "vitest";
import { MAX_VERTICES, createToolStore, groupTools, type DrawSpec, type MapTool } from "./toolStore";

const tool = (id: string, draw: DrawSpec, extra: Partial<MapTool> = {}): MapTool => ({
  id,
  group: "measure",
  topic: "measure",
  order: 0,
  icon: "measure",
  label: id,
  action: id,
  hint: "",
  draw,
  ...extra,
});

const TOOLS = new Map<string, MapTool>(
  [
    tool("select", { shape: "none" }, { group: "navigate" }),
    tool("pan", { shape: "none" }, { group: "navigate", order: 1 }),
    tool("pin", { shape: "point" }),
    tool("line", { shape: "line", min: 2 }),
    tool("two", { shape: "line", min: 2, max: 2 }),
    tool("poly", { shape: "polygon", min: 3 }),
    tool("box", { shape: "box" }),
  ].map((t) => [t.id, t]),
);
const make = () => createToolStore((id) => TOOLS.get(id));

describe("the tool state machine (spec §5.1, §15)", () => {
  it("starts on Select and ignores an unknown tool", () => {
    const s = make();
    expect(s.getState().active).toBe("select");
    s.getState().activate("nope");
    expect(s.getState().active).toBe("select");
  });

  it("completes a point tool on one click", () => {
    const s = make();
    s.getState().activate("pin");
    s.getState().addVertex([1, 2]);
    expect(s.getState().completed).toEqual({
      toolId: "pin",
      geometry: { type: "Point", coordinates: [1, 2] },
    });
    expect(s.getState().draft).toEqual([]);
  });

  it("finishes a line on Enter once it has its minimum, and a two-click line by itself", () => {
    const s = make();
    s.getState().activate("line");
    s.getState().addVertex([0, 0]);
    s.getState().finish();
    expect(s.getState().completed).toBeNull();
    s.getState().addVertex([5, 0]);
    s.getState().finish();
    expect(s.getState().completed?.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [0, 0],
        [5, 0],
      ],
    });

    s.getState().activate("two");
    s.getState().addVertex([0, 0]);
    s.getState().addVertex([3, 4]);
    expect(s.getState().completed?.geometry.type).toBe("LineString");
  });

  it("closes a polygon ring on double-click, dropping the double-click's near-duplicate vertex", () => {
    const s = make();
    s.getState().activate("poly");
    for (const c of [
      [0, 0],
      [10, 0],
      [10, 10],
      [10.01, 10],
    ] as const)
      s.getState().addVertex([...c]);
    s.getState().finish(0.05);
    expect(s.getState().completed?.geometry).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 0],
        ],
      ],
    });
  });

  it("does not finish a polygon below three vertices", () => {
    const s = make();
    s.getState().activate("poly");
    s.getState().addVertex([0, 0]);
    s.getState().addVertex([1, 0]);
    s.getState().finish();
    expect(s.getState().completed).toBeNull();
    expect(s.getState().draft).toHaveLength(2);
  });

  it("removes the last vertex (Backspace, Ctrl+Z) and ignores an exact repeat", () => {
    const s = make();
    s.getState().activate("line");
    s.getState().addVertex([0, 0]);
    s.getState().addVertex([0, 0]);
    expect(s.getState().draft).toHaveLength(1);
    s.getState().addVertex([1, 1]);
    s.getState().removeVertex();
    expect(s.getState().draft).toEqual([[0, 0]]);
  });

  it("caps a drawing at 5 000 vertices", () => {
    const s = make();
    s.getState().activate("line");
    for (let i = 0; i < MAX_VERTICES + 3; i++) s.getState().addVertex([i, 0]);
    expect(s.getState().draft).toHaveLength(MAX_VERTICES);
  });

  it("cancels the draft, then the completed geometry, then reports nothing (R-W1-13)", () => {
    const s = make();
    s.getState().activate("line");
    s.getState().addVertex([0, 0]);
    expect(s.getState().cancel()).toBe("draft");
    s.getState().addVertex([0, 0]);
    s.getState().addVertex([1, 0]);
    s.getState().finish();
    expect(s.getState().cancel()).toBe("completed");
    expect(s.getState().cancel()).toBe("nothing");
    expect(s.getState().active).toBe("line");
  });

  it("ignores clicks while a completed geometry awaits its popover", () => {
    const s = make();
    s.getState().activate("pin");
    s.getState().addVertex([1, 1]);
    s.getState().addVertex([2, 2]);
    expect(s.getState().completed?.geometry).toEqual({
      type: "Point",
      coordinates: [1, 1],
    });
    s.getState().clearCompleted();
    expect(s.getState().completed).toBeNull();
  });

  it("completes a box and refuses an empty one", () => {
    const s = make();
    s.getState().activate("box");
    s.getState().completeBox([0, 0, 0, 5]);
    expect(s.getState().completed).toBeNull();
    s.getState().completeBox([0, 0, 4, 5]);
    expect(s.getState().completed?.geometry).toEqual({
      type: "Box",
      extent: [0, 0, 4, 5],
    });
  });

  it("drops the draft when the tool changes, and ignores vertices for Select", () => {
    const s = make();
    s.getState().activate("line");
    s.getState().addVertex([0, 0]);
    s.getState().activate("select");
    expect(s.getState().draft).toEqual([]);
    s.getState().addVertex([0, 0]);
    expect(s.getState().draft).toEqual([]);
  });

  it("holds Space to pan", () => {
    const s = make();
    s.getState().setPanHold(true);
    expect(s.getState().panHold).toBe(true);
    s.getState().setPanHold(false);
    expect(s.getState().panHold).toBe(false);
  });

  it("groups tools in palette order and drops empty groups", () => {
    const groups = groupTools([...TOOLS.values()]);
    expect(groups.map((g) => g.map((t) => t.id))).toEqual([
      ["select", "pan"],
      ["box", "line", "pin", "poly", "two"],
    ]);
  });
});
