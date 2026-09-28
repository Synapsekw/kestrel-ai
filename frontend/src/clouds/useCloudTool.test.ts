import { describe, expect, it } from "vitest";
import type { MPoint } from "./measure";
import {
  INITIAL_TOOL,
  canCloseArea,
  cloudToolReducer as reduce,
  isComplete,
  nearVertex,
  ringCounts,
  type CloudToolAction,
  type CloudToolState,
} from "./useCloudTool";

const p = (x: number, y: number, z = 0, u = 0.02): MPoint => ({ x, y, z, uncertainty_m: u });
const run = (actions: CloudToolAction[], from: CloudToolState = INITIAL_TOOL) => actions.reduce(reduce, from);
const pick = (q: MPoint, closes = false): CloudToolAction => ({ type: "pick", point: q, closes });

describe("useCloudTool: the point, distance, height and vertical (points) tools", () => {
  it("needs one pick for a point and two for a distance; the next click starts over", () => {
    expect(isComplete(run([{ type: "arm", kind: "point" }, pick(p(1, 1))]))).toBe(true);
    const d = run([{ type: "arm", kind: "distance" }, pick(p(0, 0)), pick(p(3, 4))]);
    expect(isComplete(d)).toBe(true);
    expect(run([pick(p(9, 9))], d).picks).toEqual([p(9, 9)]);
  });

  it("drops hover and picks when nothing is armed", () => {
    expect(run([pick(p(1, 1)), { type: "hover", point: p(1, 1) }])).toEqual(INITIAL_TOOL);
  });

  it("keeps the options when re-armed and clears the picks", () => {
    const s = run([{ type: "arm", kind: "area" }, { type: "mode", mode: "plan" }, pick(p(0, 0))]);
    const again = run([{ type: "arm", kind: "distance" }], s);
    expect(again.picks).toEqual([]);
    expect(again.mode).toBe("plan");
  });
});

describe("useCloudTool: area", () => {
  const square = [p(0, 0), p(2, 0), p(2, 2), p(0, 2)];
  const armed = run([{ type: "arm", kind: "area" }, ...square.map((q) => pick(q))]);

  it("is open until closed; Enter's close drops nothing and completes it", () => {
    expect(isComplete(armed)).toBe(false);
    expect(canCloseArea(armed)).toBe(true);
    const closed = run([{ type: "close" }], armed);
    expect(closed.closed).toBe(true);
    expect(closed.picks).toHaveLength(4);
    expect(isComplete(closed)).toBe(true);
  });

  it("a click near the first vertex closes the outline", () => {
    const closed = run([pick(p(0.01, 0.01), true)], armed);
    expect(closed.closed).toBe(true);
    expect(closed.picks).toEqual(square);
  });

  it("a click on the last vertex (a double-click) closes without adding a vertex", () => {
    const s = run([pick(p(1, 3)), pick(p(1, 3.001), true)], armed);
    expect(s.picks).toEqual([...square, p(1, 3)]);
    expect(s.closed).toBe(true);
  });

  it("drops a repeated click on the same point", () => {
    expect(run([pick(p(1, 3)), pick(p(1, 3))], armed).picks).toEqual([...square, p(1, 3)]);
  });

  it("drops a closing vertex that repeats the first one", () => {
    const s = run([pick(p(0, 0)), { type: "close" }], armed);
    expect(s.picks).toEqual(square);
  });

  it("cannot close fewer than three vertices", () => {
    const two = run([{ type: "arm", kind: "area" }, pick(p(0, 0)), pick(p(1, 0)), { type: "close" }]);
    expect(two.closed).toBe(false);
    expect(run([pick(p(0, 0.001), true)], two).picks).toHaveLength(3);
  });

  it("Backspace removes the last vertex and reopens the outline", () => {
    const s = run([{ type: "close" }, { type: "backspace" }], armed);
    expect(s.closed).toBe(false);
    expect(s.picks).toEqual(square.slice(0, 3));
  });

  it("a click on a closed outline starts a new one", () => {
    expect(run([{ type: "close" }, pick(p(5, 5))], armed).picks).toEqual([p(5, 5)]);
  });

  it("stops adding vertices at 200", () => {
    const many = Array.from({ length: 205 }, (_, i) => pick(p(Math.cos(i), Math.sin(i), i)));
    expect(run([{ type: "arm", kind: "area" }, ...many]).picks).toHaveLength(200);
  });
});

describe("useCloudTool: vertical by rings", () => {
  const rings = run([
    { type: "arm", kind: "vertical" },
    { type: "method", method: "rings" },
  ]);
  const lower = [p(1, 0, 0), p(0, 1, 0), p(-1, 0, 0)].map((q) => pick(q));
  const upper = [p(1, 0, 10), p(0, 1, 10), p(-1, 0, 10)].map((q) => pick(q));

  it("groups picks by ring, N moves to the upper ring after three picks", () => {
    const early = run([pick(p(1, 0, 0)), { type: "next-ring" }], rings);
    expect(early.ring).toBe(0);
    const s = run([...lower, { type: "next-ring" }, ...upper], rings);
    expect(ringCounts(s.picks)).toEqual([3, 3]);
    expect(s.picks.map((q) => q.group)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(isComplete(s)).toBe(true);
  });

  it("Backspace on an empty upper ring returns to the lower ring", () => {
    const s = run([...lower, { type: "next-ring" }, { type: "backspace" }], rings);
    expect(s.ring).toBe(0);
    expect(s.picks).toHaveLength(3);
  });

  it("switching the method clears the picks", () => {
    const s = run([...lower, { type: "method", method: "points" }], rings);
    expect(s.picks).toEqual([]);
    expect(s.ring).toBe(0);
  });

  it("stops at 64 picks", () => {
    const many = Array.from({ length: 70 }, (_, i) => pick(p(Math.cos(i), Math.sin(i), 0)));
    expect(run(many, rings).picks).toHaveLength(64);
  });
});

describe("useCloudTool: cross-section", () => {
  it("the profile line takes A's Z", () => {
    const s = run([{ type: "arm", kind: "profile" }, pick(p(0, 0, 12.5)), pick(p(10, 0, 40))]);
    expect(s.picks[1]).toEqual(p(10, 0, 12.5));
    expect(isComplete(s)).toBe(true);
  });

  it("keeps the thickness across re-arms", () => {
    const s = run([
      { type: "arm", kind: "profile" },
      { type: "thickness", thicknessM: 0.5 },
      { type: "arm", kind: "profile" },
    ]);
    expect(s.thicknessM).toBe(0.5);
  });
});

describe("nearVertex", () => {
  const project = (q: MPoint) => ({ x: q.x * 100, y: q.y * 100 });
  it("is true within 10 px of the vertex's projection", () => {
    expect(nearVertex(project, p(0, 0), p(0.05, 0.05))).toBe(true);
    expect(nearVertex(project, p(0, 0), p(0.2, 0))).toBe(false);
  });
  it("is false when either point is behind the camera", () => {
    expect(nearVertex(() => null, p(0, 0), p(0, 0))).toBe(false);
  });
});
