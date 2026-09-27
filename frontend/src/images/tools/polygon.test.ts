import { describe, expect, it } from "vitest";
import {
  MAX_VERTICES,
  polygonClosable,
  polygonDown,
  polygonMove,
  polygonRemoveLast,
  polygonUp,
  type PolygonDraft,
} from "./polygon";

const view = { scale: 2, x: 0, y: 0 };
const at = (x: number, y: number) => ({ image: { x, y }, screen: { x: x * 2, y: y * 2 } });
const click = (d: PolygonDraft | null, x: number, y: number) => {
  const p = at(x, y);
  const r = polygonDown(d, p.image, p.screen, view);
  return { ...r, draft: polygonUp(r.draft) };
};

describe("polygon machine", () => {
  it("adds a vertex per click and closes on the first vertex", () => {
    let d = click(null, 10, 10).draft;
    d = click(d, 60, 10).draft;
    d = click(d, 60, 50).draft;
    expect(d.points).toHaveLength(3);
    const close = click(d, 11, 11); // 2 screen px from the first vertex
    expect(close.close).toBe(true);
    expect(close.draft.points).toHaveLength(3);
  });

  it("closing on the first vertex adds no vertex", () => {
    let d = click(null, 0, 0).draft;
    d = click(d, 50, 0).draft;
    d = click(d, 50, 50).draft;
    d = click(d, 0, 50).draft;
    const r = click(d, 0, 0);
    expect(r.close).toBe(true);
    expect(r.draft.points).toHaveLength(4);
  });

  it("refuses to close with two distinct vertices", () => {
    let d = click(null, 0, 0).draft;
    d = click(d, 50, 0).draft;
    d = click(d, 50, 0.1).draft; // under 1 screen px from the last: ignored
    expect(d.points).toHaveLength(2);
    expect(polygonClosable(d)).toBe(false);
    expect(click(d, 0, 0).close).toBe(false);
  });

  it("streams a vertex every 4 screen px while dragging", () => {
    const start = at(0, 0);
    let d = polygonDown(null, start.image, start.screen, view).draft;
    for (let x = 1; x <= 10; x++) {
      const p = at(x, 0); // 2 screen px per step
      d = polygonMove(d, p.image, p.screen);
    }
    d = polygonUp(d);
    expect(d.points.map((p) => p.x)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("moving without a press only moves the cursor", () => {
    const d = polygonMove(click(null, 0, 0).draft, { x: 30, y: 30 }, { x: 60, y: 60 });
    expect(d.points).toHaveLength(1);
    expect(d.cursor).toEqual({ x: 30, y: 30 });
  });

  it("Backspace removes the last vertex and the draft ends when empty", () => {
    let d: PolygonDraft | null = click(click(null, 0, 0).draft, 10, 0).draft;
    d = polygonRemoveLast(d);
    expect(d!.points).toHaveLength(1);
    expect(polygonRemoveLast(d!)).toBeNull();
  });

  it(`stops adding at ${MAX_VERTICES} vertices`, () => {
    const full: PolygonDraft = {
      kind: "polygon",
      points: Array.from({ length: MAX_VERTICES }, (_, i) => ({ x: i, y: i % 2 })),
      cursor: null,
      pressed: false,
      lastScreen: null,
    };
    expect(click(full, 5000, 5000).draft.points).toHaveLength(MAX_VERTICES);
  });
});
