import { describe, expect, it } from "vitest";
import { gizmoAxes } from "./gizmo";

const byAxis = (dir: [number, number, number]) =>
  Object.fromEntries(gizmoAxes(dir, 24).map((a) => [a.axis, a])) as unknown as Record<
    "x" | "y" | "z",
    { dx: number; dy: number; away: boolean }
  >;

describe("gizmoAxes", () => {
  it("looking north: east to the right, up is up, north points away", () => {
    const a = byAxis([0, 1, 0]);
    expect(a.x.dx).toBeCloseTo(24);
    expect(a.x.dy).toBeCloseTo(0);
    expect(a.z.dx).toBeCloseTo(0);
    expect(a.z.dy).toBeCloseTo(-24); // SVG y grows downwards
    expect(a.y.away).toBe(true);
    expect(a.x.away).toBe(false);
  });

  it("looking straight down: east right, north up, Z towards the viewer", () => {
    const a = byAxis([0, 0, -1]);
    expect(a.x.dx).toBeCloseTo(24);
    expect(a.y.dy).toBeCloseTo(-24);
    expect(a.z.away).toBe(false);
    expect(Math.hypot(a.z.dx, a.z.dy)).toBeCloseTo(0);
  });

  it("draws the axes pointing away first, so the near ones sit on top", () => {
    const order = gizmoAxes([-0.58, 0.58, -0.57], 24).map((a) => a.away);
    expect(order).toEqual([...order].sort((p, q) => Number(q) - Number(p)));
  });
});
