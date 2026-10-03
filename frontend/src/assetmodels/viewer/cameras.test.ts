import { describe, expect, it } from "vitest";
import { CAMERA_PICK_PX, cameraPosesFrom, frustumCorners, nearestOnScreen, pyramidGeometry } from "./cameras";

describe("camera glyphs", () => {
  it("maps the contract's poses", () => {
    const rows = [
      {
        image_id: "i1",
        position: [1, 2, 3],
        target: [0, 0, 0],
        up: [0, 1, 0],
        hfov_deg: 70,
        vfov_deg: 52,
        source: "kit",
        accuracy_m: null,
        sequence: "A",
        outcome: "finding",
        updated_at: "2026-10-03T00:00:00Z",
      },
    ];
    expect(cameraPosesFrom(rows as never)).toEqual([
      {
        imageId: "i1",
        position: [1, 2, 3],
        target: [0, 0, 0],
        up: [0, 1, 0],
        hfovDeg: 70,
        vfovDeg: 52,
        sequence: "A",
        outcome: "finding",
      },
    ]);
  });

  it("spans the field of view at the target distance", () => {
    const c = frustumCorners(90, 60, 10);
    expect(c[0]).toEqual([0, 0, 0]);
    expect(c[1][0]).toBeCloseTo(-10);
    expect(c[1][1]).toBeCloseTo(-10 * Math.tan(Math.PI / 6));
    expect(c[1][2]).toBe(-10);
  });

  it("builds a pyramid that points down -z", () => {
    const g = pyramidGeometry();
    g.computeBoundingBox();
    expect(g.boundingBox!.max.z).toBeCloseTo(0);
    expect(g.boundingBox!.min.z).toBeCloseTo(-1);
  });

  it("picks the nearest camera within 13 px and ignores ones behind the view", () => {
    const vp = { width: 200, height: 100 };
    const pts = [
      { id: "a", x: 0, y: 0, z: 0.5 }, // screen (100, 50)
      { id: "b", x: 0.1, y: 0, z: 0.5 }, // screen (110, 50)
      { id: "behind", x: 0.02, y: 0, z: 1.5 }, // beyond the far plane
    ];
    expect(CAMERA_PICK_PX).toBe(13);
    expect(nearestOnScreen(pts, 108, 50, vp)).toBe("b");
    expect(nearestOnScreen(pts, 101, 50, vp)).toBe("a");
    expect(nearestOnScreen(pts, 140, 50, vp)).toBeNull();
    expect(nearestOnScreen([pts[2]], 102, 50, vp)).toBeNull();
  });
});
