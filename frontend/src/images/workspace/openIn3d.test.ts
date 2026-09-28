import { describe, expect, it } from "vitest";
import { exampleCloud } from "@/test/cloudFixtures";
import { cloudsContaining, openIn3dHref } from "./openIn3d";

const inside = { lon: 48.375, lat: 28.703 };
const cloud = (id: string, created_at: string, over = {}) => ({ ...exampleCloud, id, created_at, ...over });

describe("cloudsContaining", () => {
  it("keeps ready clouds whose WGS84 bounds hold the point, newest first", () => {
    const got = cloudsContaining(
      [
        cloud("old", "2026-01-01T00:00:00Z"),
        cloud("new", "2026-06-01T00:00:00Z"),
        cloud("importing", "2026-07-01T00:00:00Z", { status: "importing" }),
        cloud("nobounds", "2026-07-01T00:00:00Z", { bounds_wgs84: null }),
        cloud("far", "2026-07-01T00:00:00Z", { bounds_wgs84: [0, 0, 1, 1] }),
      ],
      inside.lon,
      inside.lat,
    );
    expect(got.map((c) => c.id)).toEqual(["new", "old"]);
  });
  it("includes the edge and caps at five", () => {
    const many = Array.from({ length: 8 }, (_, i) => cloud(`c${i}`, `2026-0${i + 1}-01T00:00:00Z`));
    expect(cloudsContaining(many, 48.3712, 28.7004)).toHaveLength(5);
  });
  it("is empty without GPS", () => {
    expect(cloudsContaining([exampleCloud], null, null)).toEqual([]);
  });
});

it("links C's image to cloud jump at the frame centre", () => {
  expect(openIn3dHref("p1", "c1", "i1", 4000, 2667)).toBe("/p/p1/clouds/c1?from_image=i1&px=2000,1334");
});
