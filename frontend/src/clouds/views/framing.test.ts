import { describe, expect, it } from "vitest";
import type { CloudViewPose } from "@contract/client";
import { POSE } from "@/test/cloudViewFixtures";
import { autoFramePoint, autoFrameSphere, boundingSphere, copyPose, retarget } from "./framing";

const cam = (over: Partial<CloudViewPose> = {}): CloudViewPose => ({ ...POSE, ...over });
const close = (a: number[], b: number[], digits = 6) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const D25 = Math.sin((25 * Math.PI) / 180);

describe("auto framing on a point", () => {
  it("keeps the view direction and the current distance when it is inside 6..60 m", () => {
    const pose = autoFramePoint(cam(), [100, 200, 5]);
    close(pose.position, [100, 190, 15]);
    expect(pose.target).toEqual([100, 200, 5]);
    expect(pose.up).toEqual([0, 0, 1]);
    expect(pose.fov_deg).toBe(50);
  });

  it("clamps the distance to 60 m and to 6 m", () => {
    close(autoFramePoint(cam({ position: [0, -100, 100] }), [0, 0, 0]).position, [
      0,
      -60 * Math.SQRT1_2,
      60 * Math.SQRT1_2,
    ]);
    close(autoFramePoint(cam({ position: [0, -1, 1] }), [0, 0, 0]).position, [
      0,
      -6 * Math.SQRT1_2,
      6 * Math.SQRT1_2,
    ]);
  });

  it("auto framing from a straight-down camera picks a horizontal up", () => {
    const pose = autoFramePoint(cam({ position: [0, 0, 30], target: [0, 0, 0] }), [5, 5, 0]);
    expect(pose.up).toEqual([0, 1, 0]);
    close(pose.position, [5, 5, 30]);
    expect([...pose.position, ...pose.up].every(Number.isFinite)).toBe(true);
  });

  it("falls back to north and 45 degrees down when the camera sits on its target", () => {
    const pose = autoFramePoint(cam({ position: [1, 1, 1], target: [1, 1, 1] }), [0, 0, 0]);
    close(pose.position, [0, -6 * Math.SQRT1_2, 6 * Math.SQRT1_2]);
  });
});

describe("auto framing on a geometry", () => {
  it("bounds the points with the box centre and the farthest point", () => {
    expect(
      boundingSphere([
        [0, 0, 0],
        [2, 0, 0],
      ]),
    ).toEqual({ centre: [1, 0, 0], radius: 1 });
  });

  it("fits the sphere x 1.4 inside a 50 degree vertical fov", () => {
    const pose = autoFrameSphere(cam(), [
      [0, 0, 0],
      [2, 0, 0],
    ]);
    const d = 1.4 / D25; // 3.31268 m
    close(pose.target, [1, 0, 0]);
    close(pose.position, [1, -d * Math.SQRT1_2, d * Math.SQRT1_2], 5);
    expect(pose.fov_deg).toBe(50);
  });

  it("gives a single point a 0.5 m sphere", () => {
    const d = (0.5 * 1.4) / D25;
    close(autoFrameSphere(cam(), [[3, 3, 3]]).position, [3, 3 - d * Math.SQRT1_2, 3 + d * Math.SQRT1_2], 5);
  });
});

describe("copy and retarget", () => {
  it("copies a pose without sharing arrays", () => {
    const src = cam();
    const out = copyPose(src);
    expect(out).toEqual(src);
    expect(out.position).not.toBe(src.position);
  });

  it("moves a stored pose with its target, keeping the offset", () => {
    expect(
      retarget({ position: [0, -10, 10], target: [0, 0, 0], up: [0, 0, 1], fov_deg: 50 }, [5, 5, 5]),
    ).toEqual({
      position: [5, -5, 15],
      target: [5, 5, 5],
      up: [0, 0, 1],
      fov_deg: 50,
    });
  });
});
