import { describe, expect, it } from "vitest";
import {
  CONFINED,
  DSM,
  LAS,
  MAPPING,
  ORTHO,
  PDF,
  THERMAL,
  VERTICAL,
  VIDEO,
  VISUAL,
  bucket,
  draftBucket,
} from "@/test/setupFixtures";
import type { TemplateSlot } from "./api";
import { bucketId, canMoveTo, mergeBuckets, mergeNotRecognised, remap, slotFor } from "./remap";

const ALL = [VISUAL, THERMAL, ORTHO, DSM, LAS, PDF, VIDEO].map((b) => draftBucket(b));
const TEMPLATE_SLOTS: [string, TemplateSlot[]][] = [
  ["Mapping", MAPPING.config.slots],
  ["Vertical", VERTICAL.config.slots],
  ["Confined", CONFINED.config.slots],
  ["Blank", []],
];
// Where each bucket of ALL lands, in order: VISUAL, THERMAL, ORTHO, DSM, LAS, PDF, VIDEO.
const EXPECTED: Record<string, (string | null)[]> = {
  Mapping: ["raw", "raw", "ortho", "dsm", null, "design", null],
  Vertical: ["visual", "thermal", null, null, "cloud", "drawings", null],
  Confined: ["stills", "stills", null, null, "lidar", "drawings", "video"],
  Blank: [null, null, null, null, null, null, null],
};
const keys = (bs: { slot_key: string | null }[]) => bs.map((b) => b.slot_key);
const S = (key: string, route: TemplateSlot["route"], match: TemplateSlot["match"]): TemplateSlot => ({
  key,
  label: key,
  route,
  required: false,
  accepts: ["x"],
  match,
});

describe("remap", () => {
  it.each(TEMPLATE_SLOTS)("sorts every kind of bucket into %s", (name, slots) => {
    expect(keys(remap(ALL, slots))).toEqual(EXPECTED[name]);
  });

  const pairs = TEMPLATE_SLOTS.flatMap(([from, a]) =>
    TEMPLATE_SLOTS.map(([to, b]) => [from, to, a, b] as const),
  );
  it.each(pairs)("%s then %s lands where the second alone would", (_from, to, a, b) => {
    expect(keys(remap(remap(ALL, a), b))).toEqual(EXPECTED[to]);
  });

  // Coordinator ruling (from the U3 planner): the page and the backend's assign_slots pick the same slot.
  it.each([
    ["the route must be equal", [S("d", "drawing", null)], VISUAL, null],
    ["match null takes every bucket of its route", [S("any", "images", null)], THERMAL, "any"],
    ["a key the slot names must equal the bucket's", [S("vis", "images", { thermal: false })], THERMAL, null],
    [
      "a missing thermal counts as false",
      [S("vis", "images", { thermal: false })],
      bucket({ route: "images", folder: "E:\\A", match: {} }),
      "vis",
    ],
    [
      "the slot naming more keys beats match null",
      [S("any", "images", null), S("ir", "images", { thermal: true })],
      THERMAL,
      "ir",
    ],
    [
      "raster must be equal",
      [S("ortho", "map", { raster: "ortho" })],
      bucket({ route: "map", folder: "E:\\A", match: { raster: "elevation" } }),
      null,
    ],
    ["a tie goes to template order", [S("a", "drawing", null), S("b", "drawing", null)], PDF, "a"],
    [
      "a tie between equally specific slots goes to template order",
      [S("a", "images", { thermal: true }), S("b", "images", { thermal: true })],
      THERMAL,
      "a",
    ],
  ] as const)("slot fit, the same rule as assign_slots: %s", (_case, slots, b, expected) => {
    expect(slotFor(b, slots)).toBe(expected);
  });

  it("keeps a skipped bucket skipped and still knows its slot", () => {
    const out = remap([draftBucket(VISUAL, { skipped: true })], VERTICAL.config.slots);
    expect(out[0]).toMatchObject({ skipped: true, slot_key: "visual" });
  });
});

describe("bucket identity and merging", () => {
  it("names a bucket by route, match and folder, ignoring case and a trailing separator", () => {
    expect(bucketId(VISUAL)).toBe(bucketId({ ...VISUAL, folder: "e:\\dcim\\100media\\" }));
    expect(bucketId(VISUAL)).not.toBe(bucketId(THERMAL));
  });

  it("replaces a re-dropped folder in place and appends new buckets", () => {
    const first = [
      draftBucket(VISUAL, { slot_key: "visual" }),
      draftBucket(THERMAL, { slot_key: "thermal" }),
    ];
    const again = draftBucket({ ...VISUAL, count: 700 }, { slot_key: "visual" });
    const merged = mergeBuckets(first, [again, draftBucket(LAS, { slot_key: "cloud" })]);
    expect(merged.map((b) => [b.id, b.count])).toEqual([
      [bucketId(VISUAL), 700],
      [bucketId(THERMAL), 88],
      [bucketId(LAS), 1],
    ]);
  });

  it("two file picks from one folder keep both buckets; a later folder drop replaces them with one", () => {
    const north = bucket({
      route: "map",
      match: { raster: "ortho" },
      folder: "E:\\Survey",
      files: ["E:\\Survey\\ortho_north.tif"],
    });
    const south = { ...north, files: ["E:\\Survey\\ORTHO_SOUTH.tif"] };
    const pick = (b: typeof north) => draftBucket(b, { id: bucketId(b, b.files) });
    // A file pick names its files; a run of the folder (or a parent) does not.
    expect(bucketId(north, north.files)).toBe(`${bucketId(north)}|e:\\survey\\ortho_north.tif`);
    expect(bucketId(north, ["e:\\survey\\"])).toBe(bucketId(north));
    expect(bucketId(north, ["E:\\"])).toBe(bucketId(north));
    expect(bucketId(VISUAL, ["E:\\Elsewhere\\x.jpg"])).toBe(bucketId(VISUAL));

    const picked = mergeBuckets(mergeBuckets([draftBucket(LAS)], [pick(north)]), [pick(south)]);
    expect(picked.map((b) => b.files)).toEqual([LAS.files, north.files, south.files]);
    // The same file picked again replaces its own bucket.
    expect(mergeBuckets(picked, [pick({ ...north, count: 3 })]).map((b) => b.count)).toEqual([1, 3, 1]);

    const folder = draftBucket({ ...north, files: [...north.files, ...south.files], count: 2 });
    const dropped = mergeBuckets(picked, [folder]);
    expect(dropped.map((b) => [b.id, b.count])).toEqual([
      [bucketId(LAS), 1],
      [bucketId(north), 2],
    ]);
  });

  it("adds up what was not recognised and keeps at most 50 names", () => {
    const sample = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `f${i}.bin`, reason: "unknown type" }));
    const merged = mergeNotRecognised({ count: 40, samples: sample(40) }, { count: 30, samples: sample(30) });
    expect(merged.count).toBe(70);
    expect(merged.samples).toHaveLength(50);
  });

  it("moves a bucket only within its route, or between orthomosaic and elevation", () => {
    const [ortho, dsm, design, raw] = MAPPING.config.slots;
    expect(canMoveTo(ORTHO, dsm)).toBe(true);
    expect(canMoveTo(DSM, ortho)).toBe(true);
    expect(canMoveTo(VISUAL, design)).toBe(false);
    expect(canMoveTo(ORTHO, raw)).toBe(false);
  });
});
