import { Color, Line, LineBasicMaterial, LineSegments, Points, PointsMaterial } from "three";
import { describe, expect, it } from "vitest";
import { localPositions, overlayObject } from "./overlay";

describe("overlay geometry", () => {
  it("stores UTM points relative to a local origin so float32 keeps millimetres", () => {
    const origin = { x: 243000, y: 3178000, z: 0 };
    const pts = [
      { x: 243522.123, y: 3178252.456, z: -44.321 },
      { x: 243522.124, y: 3178252.457, z: 175.6 },
    ];
    const local = localPositions(pts, origin);
    expect(local.length).toBe(6);
    expect(Math.abs(local[0] + origin.x - pts[0].x)).toBeLessThan(1e-4);
    expect(Math.abs(local[1] + origin.y - pts[0].y)).toBeLessThan(1e-4);
    expect(local[4] - local[1]).toBeCloseTo(0.001, 4);
    // the naive absolute Float32Array loses the millimetre
    expect(Math.abs(new Float32Array([pts[0].y])[0] - pts[0].y)).toBeGreaterThan(1e-3);
  });

  it("closes a ring by repeating the first point", () => {
    const o = { x: 0, y: 0, z: 0 };
    expect(
      Array.from(
        localPositions(
          [
            { x: 1, y: 2, z: 3 },
            { x: 4, y: 5, z: 6 },
          ],
          o,
          true,
        ),
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3]);
  });
});

describe("token colours in WebGL", () => {
  it("a 0-255 token renders as itself, not brightened by a second sRGB encoding", async () => {
    const THREE = await import("three");
    const { tokenColor } = await import("./overlay");
    // the canvas token: `new THREE.Color(21 / 255, …)` takes the numbers as linear and the sRGB
    // output then shows (81, 92, 88), the grey the acceptance saw and sampleColours never matched
    expect(tokenColor([21, 27, 25]).getHexString(THREE.SRGBColorSpace)).toBe("151b19");
    expect(tokenColor([229, 175, 100]).getHexString(THREE.SRGBColorSpace)).toBe("e5af64");
  });
});

describe("overlay objects", () => {
  const origin = { x: 243000, y: 3178000, z: 0 };
  const pts = [
    { x: 243001, y: 3178001, z: 1 },
    { x: 243002, y: 3178002, z: 2 },
  ];
  const red = new Color(1, 0, 0);

  it("builds a line exactly as before: no depth test, transparent", () => {
    const o = overlayObject({ kind: "line", points: pts, tone: "accent", closed: true }, origin, red);
    expect(o).toBeInstanceOf(Line);
    expect(o).not.toBeInstanceOf(LineSegments);
    const m = o.material as LineBasicMaterial;
    expect([m.depthTest, m.transparent]).toEqual([false, true]);
    expect(o.geometry.getAttribute("position").count).toBe(3); // closed repeats the first point
  });

  it("builds points at 8 px by default, or the given size", () => {
    const a = overlayObject({ kind: "points", points: pts, tone: "ok" }, origin, red);
    const b = overlayObject({ kind: "points", points: pts, tone: "ok", size: 7 }, origin, red);
    expect(a).toBeInstanceOf(Points);
    expect((a.material as PointsMaterial).size).toBe(8);
    expect((a.material as PointsMaterial).sizeAttenuation).toBe(false);
    expect((b.material as PointsMaterial).size).toBe(7);
  });

  it("builds segments as one LineSegments draw call with the given opacity", () => {
    const o = overlayObject({ kind: "segments", points: pts, tone: "accent", opacity: 0.65 }, origin, red);
    expect(o).toBeInstanceOf(LineSegments);
    const m = o.material as LineBasicMaterial;
    expect([m.opacity, m.transparent, m.depthTest]).toEqual([0.65, true, false]);
    expect(o.geometry.getAttribute("position").count).toBe(2);
    expect(o.renderOrder).toBe(10);
  });
});
