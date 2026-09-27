import { Vector3 } from "three";
import { ClipMode, PointCloudOctreePicker, type IClipBox } from "potree-core";
import { describe, expect, it } from "vitest";
import {
  applyClipToMaterial,
  clipBoxMatrix,
  insideClipBox,
  makeClipBox,
  pickClipParams,
  respectClip,
  toCloudClipBox,
  type ClipBox,
  type ClipState,
} from "./clipBox";
import type { DrawnPoint } from "./pickAll";
import { nearestToCentre } from "./topmost";
import type { Vec3 } from "./types";

/** The two fields of a pick material the clip code writes, as potree's material stores them. */
class FakeMaterial {
  clipMode: ClipMode = ClipMode.DISABLED;
  clipBoxes: IClipBox[] = [];
  setClipBoxes(boxes: IClipBox[]) {
    this.clipBoxes = boxes;
  }
}

describe("clip box matrix", () => {
  it("scales, rotates counter-clockwise about +Z, then translates", () => {
    const box: ClipBox = { centre: [10, 20, 30], size: [4, 2, 6], yawDeg: 90 };
    const m = clipBoxMatrix(box);
    // the unit cube's +x face centre goes to centre + (0, size_x / 2, 0) after a 90° CCW yaw
    const p = new Vector3(0.5, 0, 0).applyMatrix4(m);
    expect(p.x).toBeCloseTo(10, 9);
    expect(p.y).toBeCloseTo(22, 9);
    expect(p.z).toBeCloseTo(30, 9);
    const top = new Vector3(0, 0, 0.5).applyMatrix4(m);
    expect(top.z).toBeCloseTo(33, 9);
  });

  it("makeClipBox carries the rotated matrix and its inverse for the shader", () => {
    const box: ClipBox = { centre: [1, 2, 3], size: [2, 2, 2], yawDeg: 30 };
    const cb = makeClipBox(box);
    const back = new Vector3(1, 2, 3).applyMatrix4(cb.inverse);
    expect(back.length()).toBeCloseTo(0, 9);
    expect(cb.matrix.equals(clipBoxMatrix(box))).toBe(true);
  });
});

describe("insideClipBox", () => {
  it("agrees with the matrix inverse at small coordinates", () => {
    const box: ClipBox = { centre: [3, -2, 1], size: [4, 2, 1], yawDeg: 30 };
    const inv = clipBoxMatrix(box).invert();
    for (let i = 0; i < 200; i += 1) {
      const p: Vec3 = [3 + Math.sin(i) * 3, -2 + Math.cos(i * 1.7) * 3, 1 + Math.sin(i * 0.3)];
      const l = new Vector3(...p).applyMatrix4(inv);
      const expected = Math.max(Math.abs(l.x), Math.abs(l.y), Math.abs(l.z)) <= 0.5;
      expect(insideClipBox(p, box)).toBe(expected);
    }
  });

  it("decides inside/outside to the millimetre at UTM magnitude with a yaw", () => {
    const box: ClipBox = { centre: [243550, 3178050, 10], size: [10, 4, 20], yawDeg: 30 };
    const a = (30 * Math.PI) / 180;
    // along the box's local +x axis, at its edge (5 m from the centre) ± 1 mm
    const at = (d: number): Vec3 => [243550 + d * Math.cos(a), 3178050 + d * Math.sin(a), 10];
    expect(insideClipBox(at(4.999), box)).toBe(true);
    expect(insideClipBox(at(5.001), box)).toBe(false);
  });
});

describe("respectClip", () => {
  const box: ClipBox = { centre: [0, 0, 0], size: [2, 2, 2], yawDeg: 0 };
  const hits = [
    { x: 0, y: 0, z: 0, d2: 4 },
    { x: 5, y: 0, z: 0, d2: 0 },
  ];
  it("drops hits outside the box in show_inside mode", () => {
    expect(respectClip(hits, { box, mode: "show_inside" })).toEqual([hits[0]]);
  });
  it("keeps every hit in highlight mode and without a box", () => {
    expect(respectClip(hits, { box, mode: "highlight_inside" })).toEqual(hits);
    expect(respectClip(hits, null)).toEqual(hits);
  });
});

describe("the material and the contract shape", () => {
  const box: ClipBox = { centre: [0, 0, 0], size: [2, 2, 2], yawDeg: 15 };
  it("maps the modes onto potree's ClipMode and boxes", () => {
    const m = new FakeMaterial();
    applyClipToMaterial(m, { box, mode: "show_inside" });
    expect(m.clipMode).toBe(ClipMode.CLIP_OUTSIDE);
    expect(m.clipBoxes).toHaveLength(1);
    applyClipToMaterial(m, { box, mode: "highlight_inside" });
    expect(m.clipMode).toBe(ClipMode.HIGHLIGHT_INSIDE);
    applyClipToMaterial(m, null);
    expect(m.clipMode).toBe(ClipMode.DISABLED);
    expect(m.clipBoxes).toEqual([]);
  });
  it("converts to CloudClipBox for the report view's render settings", () => {
    expect(toCloudClipBox({ box, mode: "highlight_inside" })).toEqual({
      centre: [0, 0, 0],
      size: [2, 2, 2],
      yaw_deg: 15,
      mode: "highlight_inside",
    });
    expect(toCloudClipBox(null)).toBeNull();
  });
});

// A 10 m hollow box seen from the south, looking north (+y): a front (south) wall at y = -5 and a
// back (north) wall at y = +5, 1 m apart in x and z. The clip box keeps only the back half.
function hollowBoxWalls(): Vec3[] {
  const out: Vec3[] = [];
  for (let x = -5; x <= 5; x += 1)
    for (let z = -5; z <= 5; z += 1) {
      out.push([x, -5, z]);
      out.push([x, 5, z]);
    }
  return out;
}

/**
 * A software stand-in for potree's pick render from the south: each (x, z) pixel keeps the drawn
 * point nearest the camera (smallest y), and a point the pick material clips is not drawn, by the
 * shader's rule (`inverse × p` inside the unit cube, only in CLIP_OUTSIDE mode).
 */
function softPick(points: Vec3[], material: FakeMaterial): DrawnPoint[] {
  const byPixel = new Map<string, Vec3>();
  for (const p of points) {
    if (material.clipMode === ClipMode.CLIP_OUTSIDE && material.clipBoxes.length > 0) {
      const l = new Vector3(...p).applyMatrix4(material.clipBoxes[0].inverse);
      if (Math.max(Math.abs(l.x), Math.abs(l.y), Math.abs(l.z)) > 0.5) continue;
    }
    const key = `${p[0]}|${p[2]}`;
    const seen = byPixel.get(key);
    if (!seen || p[1] < seen[1]) byPixel.set(key, p);
  }
  return [...byPixel.values()].map((p) => ({ x: p[0], y: p[1], z: p[2], d2: p[0] ** 2 + p[2] ** 2, level: 0 }));
}

describe("picks respect the box (synthetic hollow box)", () => {
  const walls = hollowBoxWalls();
  const clip: ClipState = { box: { centre: [0, 3, 0], size: [12, 6, 12], yawDeg: 0 }, mode: "show_inside" };

  it("potree-core 2.0.15's own pick material copies the boxes in CLIP_OUTSIDE mode", () => {
    const statics = PointCloudOctreePicker as unknown as {
      updatePickMaterial?: (pick: unknown, material: unknown, params: unknown) => void;
    };
    expect(typeof statics.updatePickMaterial, "potree-core no longer has updatePickMaterial").toBe("function");
    const cb = makeClipBox(clip.box);
    const material = { clipMode: ClipMode.CLIP_OUTSIDE, clipBoxes: [cb] };
    const pick = new FakeMaterial();
    statics.updatePickMaterial!(pick, material, {});
    expect(pick.clipMode).toBe(ClipMode.CLIP_OUTSIDE);
    expect(pick.clipBoxes).toEqual([cb]);
  });

  it("with a picker that ignores the box, the front wall occludes and the filtered pick is empty", () => {
    const hits = softPick(walls, new FakeMaterial());
    expect(nearestToCentre(respectClip(hits, clip))).toBeNull();
  });

  it("with the fallback on the pick material, the pick lands on the back wall", () => {
    const pick = new FakeMaterial();
    pickClipParams(clip).onBeforePickRender!(pick as never, null as never);
    const best = nearestToCentre(respectClip(softPick(walls, pick), clip));
    expect(best).toMatchObject({ x: 0, y: 5, z: 0 });
  });

  it("in highlight mode the picker draws everything and the front wall is picked", () => {
    const hl: ClipState = { ...clip, mode: "highlight_inside" };
    const pick = new FakeMaterial();
    pickClipParams(hl).onBeforePickRender!(pick as never, null as never);
    expect(pick.clipMode).toBe(ClipMode.DISABLED);
    const best = nearestToCentre(respectClip(softPick(walls, pick), hl));
    expect(best).toMatchObject({ x: 0, y: -5, z: 0 });
  });
});
