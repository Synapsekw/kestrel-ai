import { describe, expect, it } from "vitest";
import { orientedEquals } from "@/images/canvas/geometry";
import { rboxDown, rboxMove, rboxUp } from "./rbox";

const view = { scale: 1, x: 0, y: 0 };

describe("three-point rotated box machine (I-D8)", () => {
  it("drag an edge, release, move for the width, click", () => {
    let d = rboxDown(null, { x: 0, y: 0 }, view).draft!;
    d = rboxMove(d, { x: 100, y: 0 }, false);
    d = rboxUp(d, view)!;
    expect(d.stage).toBe("width");
    d = rboxMove(d, { x: 60, y: 40 }, false);
    const { draft, commit } = rboxDown(d, { x: 60, y: 40 }, view);
    expect(draft).toBeNull();
    expect(commit).toEqual({ x: 0, y: 0, w: 100, h: 40, angle: 0 });
  });

  it("Shift snaps the edge to 15 degrees", () => {
    let d = rboxDown(null, { x: 0, y: 0 }, view).draft!;
    d = rboxMove(d, { x: 100, y: 28 }, true); // ~15.6°
    expect(Math.atan2(d.b.y, d.b.x) * (180 / Math.PI)).toBeCloseTo(15);
  });

  it("a click without a drag draws nothing", () => {
    const d = rboxDown(null, { x: 5, y: 5 }, view).draft!;
    expect(rboxUp(d, view)).toBeNull();
  });

  it("a width click on the edge line keeps the draft", () => {
    let d = rboxDown(null, { x: 0, y: 0 }, view).draft!;
    d = rboxUp(rboxMove(d, { x: 100, y: 0 }, false), view)!;
    const r = rboxDown(d, { x: 50, y: 0.5 }, view);
    expect(r.commit).toBeNull();
    expect(r.draft).not.toBeNull();
  });

  // Review Focus 2: a rotated box drawn right-to-left or bottom-to-top (edge B before A on
  // screen, width on the "negative" side) must give the same rectangle as the mirror stroke.
  it("the reversed stroke gives the same rectangle", () => {
    let d = rboxDown(null, { x: 0, y: 0 }, view).draft!;
    d = rboxMove(d, { x: 100, y: 0 }, false);
    d = rboxUp(d, view)!;
    d = rboxMove(d, { x: 60, y: 40 }, false);
    const forward = rboxDown(d, { x: 60, y: 40 }, view).commit!;

    // The mirror stroke: edge drawn from (100,0) to (0,0) (bottom-to-top on screen), the width
    // point on the same physical side as the forward stroke's (60,40).
    let r = rboxDown(null, { x: 100, y: 0 }, view).draft!;
    r = rboxMove(r, { x: 0, y: 0 }, false);
    r = rboxUp(r, view)!;
    r = rboxMove(r, { x: 40, y: 40 }, false);
    const reversed = rboxDown(r, { x: 40, y: 40 }, view).commit!;

    expect(orientedEquals(forward, reversed)).toBe(true);
    expect(forward.angle).toBeGreaterThanOrEqual(0);
    expect(forward.angle).toBeLessThan(180);
    expect(forward.h).toBeGreaterThan(0);
    expect(reversed.angle).toBeGreaterThanOrEqual(0);
    expect(reversed.angle).toBeLessThan(180);
    expect(reversed.h).toBeGreaterThan(0);
  });
});
