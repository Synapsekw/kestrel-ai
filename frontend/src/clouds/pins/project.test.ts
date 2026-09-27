import { Matrix4, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import {
  occlusionTolerance,
  projectPin,
  projectPins,
  type PinCamera,
  type PinScreen,
  type V3,
} from "./project";

const ORIGIN: V3 = [243500, 3178200, -40];
const at = (dx: number, dy: number, dz: number): V3 => [ORIGIN[0] + dx, ORIGIN[1] + dy, ORIGIN[2] + dz];

/** A z-up camera 100 m south of the origin and 30 m up, looking at it, on an 800 × 500 canvas. */
function camera(): PinCamera {
  const cam = new PerspectiveCamera(60, 800 / 500, 0.1, 5000);
  cam.up.set(0, 0, 1);
  cam.position.set(0, -100, 30);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const viewProj = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  return {
    viewProj: [...viewProj.elements],
    width: 800,
    height: 500,
    position: at(0, -100, 30),
    origin: ORIGIN,
  };
}

describe("projectPin (spec §9.2 per-frame pass)", () => {
  const cam = camera();

  it("places a visible pin in canvas pixels", () => {
    const s = projectPin(at(0, 0, 0), null, cam);
    expect(s.state).toBe("visible");
    expect(s.x).toBeCloseTo(400, 6);
    expect(s.y).toBeCloseTo(250, 6);
    expect(projectPin(at(10, 0, 0), null, cam).x).toBeGreaterThan(400);
    expect(projectPin(at(0, 0, 10), null, cam).y).toBeLessThan(250);
  });

  it("hides a pin behind the camera even when its mirrored projection lands on the canvas", () => {
    // Directly behind the camera along its view axis: x/w and y/w are ~0, only w says "behind".
    expect(projectPin(at(0, -200, 60), null, cam).state).toBe("hidden");

    // Hand-built viewProj that isolates the `w > 0` guard: the depth (z) row is all zero, so
    // nz ≡ 0 for every point and the depth-range check can never hide anything by itself. The w
    // row is the constant -1, negative for every point including this pin. The x/y rows send the
    // pin to the exact canvas center (nx = ny = 0), so its mirrored projection unambiguously lands
    // on the canvas. Only the `w > 0` guard can hide it here.
    // prettier-ignore
    const behindOnly: PinCamera = {
      viewProj: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, -1,
      ],
      width: 800,
      height: 500,
      position: at(0, -100, 30),
      origin: ORIGIN,
    };
    expect(projectPin(at(0, 0, 0), null, behindOnly).state).toBe("hidden");
  });

  it("hides a pin off the canvas or past the far plane", () => {
    expect(projectPin(at(500, 0, 0), null, cam).state).toBe("hidden");
    expect(projectPin(at(0, 9000, -2700), null, cam).state).toBe("hidden");
  });

  it("dims a pin whose surface faces away from the camera, never one without a normal", () => {
    expect(projectPin(at(0, 0, 0), [0, 1, 0], cam).state).toBe("back");
    expect(projectPin(at(0, 0, 0), [0, -1, 0], cam).state).toBe("visible");
    expect(projectPin(at(0, 0, 0), null, cam).state).toBe("visible");
  });

  it("hides a pin outside the clip box in show-inside mode and dims it in highlight mode", () => {
    const outside = { contains: () => false };
    expect(projectPin(at(0, 0, 0), null, cam, { ...outside, mode: "show_inside" }).state).toBe("hidden");
    const dim = projectPin(at(0, 0, 0), null, cam, { ...outside, mode: "highlight_inside" });
    expect(dim.state).toBe("back");
    expect(dim.x).toBeCloseTo(400, 6);
    expect(projectPin(at(0, 0, 0), null, cam, { contains: () => true, mode: "show_inside" }).state).toBe(
      "visible",
    );
  });

  it("writes into the caller's objects without allocating a result per pin", () => {
    const out: PinScreen[] = [
      { state: "hidden", x: 0, y: 0 },
      { state: "hidden", x: 0, y: 0 },
    ];
    const first = out[0];
    const res = projectPins(
      [
        { p: at(0, 0, 0), normal: null },
        { p: at(500, 0, 0), normal: null },
      ],
      cam,
      null,
      out,
    );
    expect(res).toBe(out);
    expect(out[0]).toBe(first);
    expect(out.map((s) => s.state)).toEqual(["visible", "hidden"]);
  });

  it("uses max(0.3 m, 3u) as the occlusion tolerance", () => {
    expect(occlusionTolerance(0.05)).toBe(0.3);
    expect(occlusionTolerance(0.2)).toBeCloseTo(0.6, 12);
  });
});
