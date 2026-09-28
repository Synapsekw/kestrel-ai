import { describe, expect, it } from "vitest";
import { cameraSet } from "@/test/cameraFixtures";
import type { PhotoHit } from "@/clouds/photoLink";
import {
  applyOffset,
  cameraZ,
  clampOffset,
  disabledReason,
  dronePose,
  glyphShapes,
  heightsLookOff,
  isPosed,
  methodLabel,
  nearestCamera,
  photoCount,
  photoLinkMessage,
  posedCount,
  spotOf,
} from "./cameraMath";

const E = 243550;
const N = 3178050;

describe("camera maths", () => {
  it("posed means yaw, pitch and altitude are all known", () => {
    const set = cameraSet([
      { x: E, y: N, z: 30, yaw: 0, pitch: -90 },
      { x: E, y: N, z: 30 },
      { x: E, y: N, z: null, yaw: 0, pitch: -90 },
    ]);
    expect([0, 1, 2].map((i) => isPosed(set, i))).toEqual([true, false, false]);
    expect(posedCount(set)).toBe(1);
  });

  it("draws a posed camera as 8 segments: apex to 4 corners 3 m ahead, and the rectangle", () => {
    const set = cameraSet([{ x: E, y: N, z: 30, yaw: 0, pitch: -90, hfov: 90, vfov: 90 }]);
    const [seg] = glyphShapes(set, 2);
    expect(seg.kind).toBe("segments");
    if (seg.kind !== "segments") throw new Error("segments expected");
    expect(seg.points).toHaveLength(16);
    expect(seg.opacity).toBe(0.65);
    // Nadir: every corner is 3 m below the apex, ±3 m (tan 45° × 3) horizontally.
    const corners = seg.points.filter((_, k) => k % 2 === 1).slice(0, 4);
    for (const c of corners) {
      expect(c.z).toBeCloseTo(27, 9);
      expect(Math.abs(c.x - E)).toBeCloseTo(3, 9);
      expect(Math.abs(c.y - N)).toBeCloseTo(3, 9);
    }
    expect(seg.points[0]).toEqual({ x: E, y: N, z: 30 });
  });

  it("a camera without an altitude is a flagged point, never a frustum", () => {
    const set = cameraSet([{ x: E, y: N, z: null, yaw: 0, pitch: -90 }], { z_p99: 1.98 });
    const shapes = glyphShapes(set, 5);
    expect(shapes).toEqual([{ kind: "points", points: [{ x: E, y: N, z: 31.98 }], tone: "warn", size: 7 }]);
    expect(dronePose(set, 0)).toBeNull();
    expect(cameraZ(cameraSet([{ x: E, y: N, z: null }], { z_p99: null }), 0, 5)).toBe(35);
  });

  it("draws position-only cameras as one accent points shape", () => {
    const set = cameraSet([
      { x: E, y: N, z: 30 },
      { x: E + 1, y: N, z: 31 },
    ]);
    expect(glyphShapes(set, 2)).toEqual([
      {
        kind: "points",
        points: [
          { x: E, y: N, z: 30 },
          { x: E + 1, y: N, z: 31 },
        ],
        tone: "accent",
        size: 7,
      },
    ]);
  });

  it("gives an empty list for an empty payload", () => {
    expect(glyphShapes(cameraSet([]), 2)).toEqual([]);
  });

  it("builds the drone pose from C-X1's camera basis", () => {
    const set = cameraSet([{ x: E, y: N, z: 30, yaw: 90, pitch: 0, w: 4000, h: 3000 }]);
    const pose = dronePose(set, 0)!;
    expect(pose.position).toEqual([E, N, 30]);
    expect(pose.forward[0]).toBeCloseTo(1, 12); // yaw 90 = grid east
    expect(pose.up[2]).toBeCloseTo(1, 12);
    expect(pose).toMatchObject({ hfovDeg: 73.7, vfovDeg: 53.1, width: 4000, height: 3000 });
  });

  it("warns when the median camera height is below p50 or far above p99", () => {
    const low = cameraSet([
      { x: E, y: N, z: -50 },
      { x: E, y: N, z: -45 },
      { x: E, y: N, z: 60 },
    ]);
    expect(heightsLookOff(low, -40)).toBe(true);
    const fine = cameraSet([{ x: E, y: N, z: 30 }]);
    expect(heightsLookOff(fine, 1)).toBe(false);
    const high = cameraSet([{ x: E, y: N, z: 1500 }], { z_p99: 170 });
    expect(heightsLookOff(high, -40)).toBe(true);
    expect(heightsLookOff(fine, null)).toBe(false);
    expect(heightsLookOff(cameraSet([{ x: E, y: N, z: null }]), 1)).toBe(false);
  });

  it("previews an offset by shifting that set's cameras and records it on the source", () => {
    const set = cameraSet([
      { x: E, y: N, z: 30 },
      { x: E, y: N, z: null },
      { x: E, y: N, z: 10, source: 1 },
    ]);
    set.sources.push({ id: "s-b", label: "B", count: 1, height_offset_m: 0, posed_count: 0 });
    const next = applyOffset(set, 0, -31.5);
    expect(next.z).toEqual([-1.5, null, 10]);
    expect(next.sources[0].height_offset_m).toBe(-31.5);
    expect(applyOffset(next, 0, 0).z).toEqual([30, null, 10]);
    expect(set.z).toEqual([30, null, 10]); // the input is not mutated
  });

  it("clamps offsets to the contract range and rounds to 0.1 m", () => {
    expect(clampOffset(-612)).toBe(-500);
    expect(clampOffset(500.04)).toBe(500);
    expect(clampOffset(1.26)).toBe(1.3);
  });

  it("finds the nearest projected camera within 8 px", () => {
    const screen = [{ x: 100, y: 100 }, null, { x: 106, y: 104 }];
    expect(nearestCamera(screen, 105, 103)).toBe(2);
    expect(nearestCamera(screen, 130, 130)).toBeNull();
  });

  it("states why the cameras cannot be shown", () => {
    expect(disabledReason("needs_coordinates", null, null)).toBe("Assign a CRS to place the drone photos");
    expect(disabledReason("ready", cameraSet([]), null)).toBe("No photos near this cloud");
    expect(disabledReason("error", null, "boom")).toBe("Could not load the drone photos: boom");
    expect(disabledReason("loading", null, null)).toBe("Loading the drone photos…");
    expect(disabledReason("ready", cameraSet([{ x: E, y: N, z: 1 }]), null)).toBeNull();
  });

  it("words the method and the toast", () => {
    expect(methodLabel("frustum")).toBe("In frame");
    expect(methodLabel("distance")).toBe("By distance");
    expect(photoLinkMessage(14, "DJI_0712.JPG", 9.44)).toBe(
      "14 photos saw this point · DJI_0712.JPG closest (9.4 m)",
    );
    expect(photoLinkMessage(1, null, 3)).toBe("1 photo saw this point (3.0 m away)");
    expect(photoLinkMessage(0, null, null)).toBe("No photo saw this point");
  });

  it("photoCount pluralises photo(s) the same way as the toast copy", () => {
    expect(photoCount(1)).toBe("1 photo");
    expect(photoCount(14)).toBe("14 photos");
    expect(photoCount(0)).toBe("0 photos");
  });

  it("spotOf gives the image-jump spot for a frustum hit, and null for a distance hit", () => {
    const frustumHit: PhotoHit = {
      index: 0,
      imageId: "img-0",
      method: "frustum",
      distanceM: 9.44,
      score: 9.44,
      px: 120.4,
      py: 88.2,
      rpx: 14,
      zAssumed: false,
    };
    expect(spotOf(frustumHit)).toEqual({ px: 120.4, py: 88.2, rpx: 14 });
    const distanceHit: PhotoHit = {
      index: 1,
      imageId: "img-1",
      method: "distance",
      distanceM: 3,
      score: 3,
      px: null,
      py: null,
      rpx: null,
      zAssumed: false,
    };
    expect(spotOf(distanceHit)).toBeNull();
  });
});
