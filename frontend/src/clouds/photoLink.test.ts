import { describe, expect, it } from "vitest";
import type { CloudCameraSet } from "@contract/client";
import { PHOTO_LINK_CAP, cameraBasis, photosSeeing } from "./photoLink";

type Cam = {
  x: number;
  y: number;
  z: number | null;
  yaw?: number | null;
  pitch?: number | null;
  roll?: number | null;
  hfov?: number;
  vfov?: number;
};

/** A payload in the contract's shape: 2048 × 1536 stored images, 73.7° × 53.1°, σ = 3 m. */
function cameras(cams: Cam[]): CloudCameraSet {
  return {
    image_id: cams.map((_, i) => `img-${i}`),
    source_idx: cams.map(() => 0),
    x: cams.map((c) => c.x),
    y: cams.map((c) => c.y),
    z: cams.map((c) => c.z),
    yaw: cams.map((c) => c.yaw ?? null),
    pitch: cams.map((c) => c.pitch ?? null),
    roll: cams.map((c) => c.roll ?? null),
    hfov: cams.map((c) => c.hfov ?? 73.7),
    vfov: cams.map((c) => c.vfov ?? 53.1),
    fov_assumed: cams.map(() => false),
    width: cams.map(() => 2048),
    height: cams.map(() => 1536),
    sigma_m: cams.map(() => 3),
    sources: [],
    truncated: false,
    z_p1: -45,
    z_p99: -5,
    without_gps: 0,
  };
}

const P = { x: 243522, y: 3178252, z: -20 };
const nadir = (dx = 0, dy = 0): Cam => ({
  x: P.x + dx,
  y: P.y + dy,
  z: P.z + 60,
  yaw: 37,
  pitch: -90,
  roll: 0,
});

describe("photosSeeing (spec §10.3)", () => {
  it("puts P at the centre pixel of a nadir camera straight above it", () => {
    const [hit] = photosSeeing(P, null, cameras([nadir()])).hits;
    expect(hit.method).toBe("frustum");
    expect(Math.abs(hit.px! - 1024)).toBeLessThan(0.5);
    expect(Math.abs(hit.py! - 768)).toBeLessThan(0.5);
    expect(hit.distanceM).toBeCloseTo(60, 9);
    expect(hit.score).toBeCloseTo(60, 9);
    expect(hit.rpx!).toBeGreaterThanOrEqual(12);
  });

  it("maps east to the right and north to the top for a north-up nadir camera", () => {
    const north = { ...nadir(), yaw: 0 };
    const east = photosSeeing({ ...P, x: P.x + 5 }, null, cameras([north])).hits[0];
    const up = photosSeeing({ ...P, y: P.y + 5 }, null, cameras([north])).hits[0];
    expect(east.px!).toBeGreaterThan(1024);
    expect(up.py!).toBeLessThan(768);
    expect(east.score).toBeGreaterThan(east.distanceM); // off-centre costs score
  });

  it("finds P at the centre of an oblique camera aimed at it", () => {
    const pitch = (-Math.atan2(40, 60) * 180) / Math.PI;
    const [hit] = photosSeeing(P, null, cameras([{ x: P.x, y: P.y - 60, z: P.z + 40, yaw: 0, pitch }])).hits;
    expect(hit.px!).toBeCloseTo(1024, 6);
    expect(hit.py!).toBeCloseTo(768, 6);
    expect(hit.distanceM).toBeCloseTo(Math.hypot(60, 40), 9);
  });

  it("rejects a camera that looks away from P", () => {
    const pitch = (-Math.atan2(40, 60) * 180) / Math.PI;
    const r = photosSeeing(P, null, cameras([{ x: P.x, y: P.y - 60, z: P.z + 40, yaw: 180, pitch }]));
    expect(r).toEqual({ hits: [], total: 0 });
  });

  it("keeps a point just outside the FOV within the tolerance, and drops one past it", () => {
    const level: Cam = { x: P.x, y: P.y, z: P.z, yaw: 0, pitch: 0 };
    const at = (deg: number) =>
      photosSeeing(
        { x: P.x + 100 * Math.tan((deg * Math.PI) / 180), y: P.y + 100, z: P.z },
        null,
        cameras([level]),
      );
    // α = atan(3 / d) + 2° ≈ 3.4° at d ≈ 127 m
    const inside = at(73.7 / 2 + 1);
    expect(inside.total).toBe(1);
    expect(inside.hits[0].px).toBe(2048); // clamped to the image edge (plan x1 Ruling 5e)
    expect(at(73.7 / 2 + 4).total).toBe(0);
  });

  it("the facing test drops cameras on the far side of a cylinder", () => {
    const eastFace: [number, number, number] = [1, 0, 0];
    const r = photosSeeing(
      P,
      eastFace,
      cameras([
        { x: P.x + 20, y: P.y, z: P.z + 10 }, // 0: position-only, east: kept
        { x: P.x - 20, y: P.y, z: P.z + 10 }, // 1: position-only, west: dropped
        { x: P.x + 40, y: P.y, z: P.z + 20, yaw: 270, pitch: -26.565 }, // 2: posed, east, aimed at P: kept
        { x: P.x - 40, y: P.y, z: P.z + 20, yaw: 90, pitch: -26.565 }, // 3: posed, west, aimed at P: dropped
        { x: P.x + 1, y: P.y + 40, z: P.z + 10 }, // 4: grazing (v·n ≈ −0.02 d > −0.05 d): dropped
      ]),
    );
    expect(r.hits.map((h) => [h.index, h.method])).toEqual([
      [2, "frustum"],
      [0, "distance"],
    ]);
  });

  it("ranks posed hits by score first, then position-only hits by distance", () => {
    const r = photosSeeing(
      P,
      null,
      cameras([
        { x: P.x + 20, y: P.y, z: P.z + 10 }, // 22.4 m
        { x: P.x + 5, y: P.y, z: P.z + 10 }, // 11.2 m
        { x: P.x + 35, y: P.y, z: P.z + 10 }, // outside max(30, 15) m: dropped
        { x: P.x + 35, y: P.y, z: P.z + 30 }, // inside max(30, 45) m: kept
        { x: P.x, y: P.y + 60, z: P.z + 60, yaw: 180, pitch: -45 }, // posed, 84.9 m
      ]),
    );
    expect(r.hits.map((h) => h.index)).toEqual([4, 1, 0, 3]);
    expect(r.hits.map((h) => h.method)).toEqual(["frustum", "distance", "distance", "distance"]);
    expect(r.hits[1].px).toBeNull();
    expect(r.total).toBe(4);
  });

  it("a camera without an altitude is ranked by distance at p99 + 30 m, flagged", () => {
    const r = photosSeeing(P, null, cameras([{ x: P.x + 1, y: P.y, z: null, yaw: 0, pitch: -90 }]));
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].method).toBe("distance");
    expect(r.hits[0].zAssumed).toBe(true);
    expect(r.hits[0].distanceM).toBeCloseTo(Math.hypot(1, -5 + 30 - P.z), 9);
  });

  it("rotates by roll: a positive roll lowers the image's right side", () => {
    const b = cameraBasis(0, 0, 10);
    expect(b.r[2]).toBeCloseTo(-Math.sin((10 * Math.PI) / 180), 12);
    const level = (roll: number) =>
      photosSeeing(
        { x: P.x + 5, y: P.y + 50, z: P.z },
        null,
        cameras([{ x: P.x, y: P.y, z: P.z, yaw: 0, pitch: 0, roll }]),
      ).hits[0];
    expect(level(0).py!).toBeCloseTo(768, 6);
    expect(level(10).py!).toBeLessThan(768);
    expect(level(-10).py!).toBeGreaterThan(768);
  });

  it("returns at most 50 hits and counts every candidate", () => {
    const r = photosSeeing(P, null, cameras(Array.from({ length: 80 }, (_, i) => nadir(i * 0.1, 0))));
    expect(r.hits).toHaveLength(PHOTO_LINK_CAP);
    expect(r.total).toBe(80);
    expect(r.hits[0].index).toBe(0);
  });

  it("scans 20 000 cameras (timing reported, not asserted)", () => {
    const set = cameras(
      Array.from({ length: 20000 }, (_, i) => ({
        x: P.x + (i % 200) - 100,
        y: P.y + Math.floor(i / 200) - 50,
        z: P.z + 60,
        yaw: (i * 7) % 360,
        pitch: -60,
      })),
    );
    const t0 = performance.now();
    const r = photosSeeing(P, [0, 0, 1], set);
    console.info(
      `photoLink: 20000 cameras in ${(performance.now() - t0).toFixed(2)} ms, ${r.total} candidates`,
    );
    expect(r.hits.length).toBeLessThanOrEqual(PHOTO_LINK_CAP);
  });
});
