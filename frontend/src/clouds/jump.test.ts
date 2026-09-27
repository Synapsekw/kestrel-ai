import { describe, expect, it } from "vitest";
import type { GeoMap } from "@contract/client";
import { exampleGeoMap } from "@/test/fixtures";
import { exampleCloud } from "@/test/cloudFixtures";
import { pixelToNative } from "@/maps/coords";
import {
  between,
  cloudToMapNative,
  cloudsForMap,
  footprintDiagonal,
  fromImageQuery,
  imageJumpHref,
  insideXY,
  jumpQuery,
  mapPixelToCloud,
  nativeToPixel,
  parseAt,
  parseCloudArrival,
  parseFinding,
  parseFootprint,
  parseFromImage,
} from "./jump";

const UTM39 = "+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs";
const UTM38 = "+proj=utm +zone=38 +datum=WGS84 +units=m +no_defs";
const map: GeoMap = {
  ...exampleGeoMap,
  id: "m1",
  epsg: 32639,
  proj4: UTM39,
  geotransform: [243500, 0.05, 0.01, 3178100, 0.02, -0.05],
};
const cloud = { ...exampleCloud, epsg: 32639, proj4: UTM39 };

describe("3D jump URLs", () => {
  it("parses and writes at and fp", () => {
    const q = new URLSearchParams("at=243522.5,3178252.25&fp=1,2;3,4;5,6;7,8");
    expect(parseAt(q)).toEqual({ x: 243522.5, y: 3178252.25 });
    expect(parseFootprint(q)).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
      { x: 7, y: 8 },
    ]);
    expect(jumpQuery({ x: 1, y: 2 })).toBe("?at=1.000,2.000");
    expect(
      jumpQuery({ x: 1, y: 2 }, [
        { x: 3, y: 4 },
        { x: 5.5, y: 6 },
      ]),
    ).toBe("?at=1.000,2.000&fp=3.000,4.000;5.500,6.000");
    for (const bad of ["at=", "at=1", "at=a,b", "at=1,2,3"])
      expect(parseAt(new URLSearchParams(bad))).toBeNull();
    expect(parseFootprint(new URLSearchParams("fp=1,2;x,4"))).toBeNull();
  });

  it("inverts an affine with rotation terms", () => {
    const [x, y] = pixelToNative(map.geotransform!, 1234.5, 678.25);
    const [px, py] = nativeToPixel(map.geotransform!, x, y);
    expect(px).toBeCloseTo(1234.5, 6); // UTM magnitudes leave ~1e-9 px of float64 noise
    expect(py).toBeCloseTo(678.25, 6);
  });

  it("is the identity between entities in the same EPSG", () => {
    const [x, y] = pixelToNative(map.geotransform!, 100, 200);
    expect(mapPixelToCloud(map, cloud, 100, 200)).toEqual({ x, y });
  });

  it("round-trips 32639 <-> 32638 within a millimetre", () => {
    const there = between({ proj4: UTM39, epsg: 32639 }, { proj4: UTM38, epsg: 32638 });
    const back = between({ proj4: UTM38, epsg: 32638 }, { proj4: UTM39, epsg: 32639 });
    const p = { x: 243522.123, y: 3178252.456 };
    const q = back(there(p));
    expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThan(0.001);
    const onMap38 = cloudToMapNative(cloud, { ...map, epsg: 32638, proj4: UTM38 }, p);
    expect(Math.abs(onMap38.x - p.x)).toBeGreaterThan(1000); // really another zone
  });

  it("finds the ready clouds linked to a map, newest first, and tests bounds", () => {
    const a = { ...cloud, id: "a", map_id: "m1", created_at: "2026-09-01T00:00:00Z" };
    const b = { ...cloud, id: "b", map_id: "m1", created_at: "2026-09-02T00:00:00Z" };
    const busy = { ...cloud, id: "c", map_id: "m1", status: "importing" as const };
    const other = { ...cloud, id: "d", map_id: "m2" };
    expect(cloudsForMap([a, busy, other, b], "m1").map((c) => c.id)).toEqual(["b", "a"]);
    expect(insideXY([0, 0, 0, 10, 10, 10], { x: 5, y: 5 })).toBe(true);
    expect(insideXY([0, 0, 0, 10, 10, 10], { x: 11, y: 5 })).toBe(false);
    expect(
      footprintDiagonal([
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 4 },
        { x: 0, y: 4 },
      ]),
    ).toBe(5);
  });
});

describe("image <-> cloud and finding jumps (spec §10.4, C9)", () => {
  const q = (s: string) => new URLSearchParams(s);

  it("parses from_image with its pixel, and ignores it when malformed", () => {
    expect(parseFromImage(q("from_image=img-1&px=120.5,88"))).toEqual({ imageId: "img-1", u: 120.5, v: 88 });
    for (const bad of [
      "from_image=img-1",
      "from_image=img-1&px=",
      "from_image=img-1&px=-1,2",
      "from_image=img-1&px=a,b",
      "from_image=img-1&px=1,2,3",
      "from_image=&px=1,2",
      "from_image=../etc&px=1,2",
      "px=1,2",
    ])
      expect(parseFromImage(q(bad)), bad).toBeNull();
  });

  it("parses a finding id and ignores a malformed one", () => {
    expect(parseFinding(q("finding=f0000000-1111-4000-8000-000000000001"))).toBe(
      "f0000000-1111-4000-8000-000000000001",
    );
    for (const bad of ["finding=", "finding=a%20b", "finding=" + "x".repeat(129), ""])
      expect(parseFinding(q(bad)), bad).toBeNull();
  });

  it("orders the arrivals finding, from_image, at", () => {
    expect(parseCloudArrival(q("finding=f1&from_image=i1&px=1,2&at=3,4"))).toEqual({
      kind: "finding",
      findingId: "f1",
    });
    expect(parseCloudArrival(q("from_image=i1&px=1,2&at=3,4"))).toEqual({
      kind: "from_image",
      imageId: "i1",
      u: 1,
      v: 2,
    });
    expect(parseCloudArrival(q("finding=a%20b&from_image=i1&px=x&at=3,4&fp=1,2;3,4"))).toEqual({
      kind: "at",
      at: { x: 3, y: 4 },
      fp: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    });
    expect(parseCloudArrival(q(""))).toBeNull();
    expect(parseCloudArrival(q("at=oops"))).toBeNull();
  });

  it("writes the image -> cloud query", () => {
    expect(fromImageQuery("img-1", 120.456, 88)).toBe("?from_image=img-1&px=120.5,88.0");
    expect(parseFromImage(q(fromImageQuery("img-1", 120.456, 88).slice(1)))).toEqual({
      imageId: "img-1",
      u: 120.5,
      v: 88,
    });
  });

  it("builds the cloud -> image link, with and without a spot", () => {
    const href = imageJumpHref("p1", "img-7", "c1", { px: 1024, py: 768.00000001, rpx: 116.2 });
    expect(href).toBe("/p/p1/images/img-7?at=1024.0,768.0&r=116&from=cloud:c1");
    const back = new URLSearchParams(href.split("?")[1]);
    expect(back.get("from")).toBe("cloud:c1");
    expect(back.get("at")).toBe("1024.0,768.0");
    expect(imageJumpHref("p1", "img-7", "c1", { px: 3, py: 4, rpx: 0.2 })).toContain("&r=1&");
    expect(imageJumpHref("p1", "img-7", "c1", null)).toBe("/p/p1/images/img-7?from=cloud:c1");
  });

  it("leaves the S1 contract unchanged", () => {
    expect(parseAt(q("at=1,2&from_image=i1&px=1,2"))).toEqual({ x: 1, y: 2 });
    expect(jumpQuery({ x: 1, y: 2 })).toBe("?at=1.000,2.000");
  });
});
