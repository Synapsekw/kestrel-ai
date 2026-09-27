import { describe, expect, it } from "vitest";
import type { LayerKind, LayerRow } from "./layerRegistry";
import { mapsFor, orderRows, placeLayers } from "./placement";

const Mount = () => null;
const kinds = new Map<string, LayerKind>([
  ["map", { id: "map", group: "base", icon: "map", rows: () => [], Mount }],
  ["dsm", { id: "dsm", group: "elevation", icon: "elevation", rows: () => [], Mount }],
  ["plan", { id: "plan", group: "drawings", icon: "drawing", rows: () => [], Mount }],
  [
    "pins",
    {
      id: "pins",
      group: "annotations",
      icon: "pin",
      rows: () => [],
      Mount,
      defaultVisible: false,
    },
  ],
]);
const row = (kind: string, id: string, date: string | null): LayerRow => ({
  key: `${kind}:${id}`,
  kind,
  group: kinds.get(kind)!.group,
  id,
  name: id,
  meta: "",
  date,
});
const AUG = "2026-08-14";
const SEP = "2026-09-14";
const JUL = "2026-07-01";
const ROWS = [
  row("map", "sep", SEP),
  row("map", "aug", AUG),
  row("map", "jul", JUL),
  row("dsm", "dsep", SEP),
  row("plan", "p", null),
  row("pins", "f", null),
];
const base = {
  rows: ROWS,
  state: {},
  order: {},
  l: AUG,
  r: SEP,
  blend: 50,
  kinds,
};

const summary = (placed: ReturnType<typeof placeLayers>["placed"]) =>
  placed.map((p) => `${p.map}/${p.row.id}/${p.side}/${p.zIndex}`);

describe("layer placement (spec §5.2 date scoping; §15 layer ordering)", () => {
  it("in Single draws every visible row, r's dated rows on top of their group", () => {
    const { placed, notInCompare } = placeLayers({ ...base, mode: "single" });
    expect(summary(placed)).toEqual([
      "single/sep/both/502",
      "single/aug/both/1",
      "single/jul/both/0",
      "single/dsep/both/1500",
      "single/p/both/2000",
    ]);
    expect(notInCompare.size).toBe(0);
  });

  it("in Swipe draws l on the left, r on the right (on top), undated on both; others nowhere", () => {
    const { placed, notInCompare } = placeLayers({ ...base, mode: "swipe" });
    expect(summary(placed)).toEqual([
      "single/sep/right/502",
      "single/aug/left/1",
      "single/dsep/right/1500",
      "single/p/both/2000",
    ]);
    expect([...notInCompare]).toEqual(["map:jul"]);
  });

  it("in Side-by-side splits dated rows between the two maps and repeats undated ones", () => {
    const { placed } = placeLayers({ ...base, mode: "side" });
    expect(summary(placed)).toEqual([
      "right/sep/right/2",
      "left/aug/left/1",
      "right/dsep/right/1000",
      "left/p/both/2000",
      "right/p/both/2000",
    ]);
  });

  it("in Blend scales the right side's opacity by the blend", () => {
    const { placed } = placeLayers({
      ...base,
      mode: "blend",
      blend: 25,
      state: { "map:sep": { visible: true, opacity: 80 } },
    });
    expect(placed.find((p) => p.row.id === "sep")?.opacity).toBeCloseTo(0.2);
    expect(placed.find((p) => p.row.id === "aug")?.opacity).toBe(1);
  });

  it("follows the operator's order within a group, new rows on top, hidden rows skipped", () => {
    const ordered = orderRows(
      ROWS.filter((r) => r.group === "base"),
      ["map:jul", "map:sep"],
    );
    expect(ordered.map((r) => r.id)).toEqual(["aug", "jul", "sep"]);
    const { placed } = placeLayers({
      ...base,
      mode: "single",
      order: { base: ["map:jul", "map:sep", "map:aug"] },
      state: { "map:aug": { visible: false, opacity: 100 } },
    });
    expect(summary(placed).slice(0, 2)).toEqual(["single/jul/both/2", "single/sep/both/501"]);
  });

  it("never places a greyed row or a row of an unknown kind", () => {
    const { placed } = placeLayers({
      ...base,
      mode: "single",
      rows: [
        {
          ...row("map", "x", null),
          unavailable: {
            reason: "no coordinates",
            href: "/",
            linkLabel: "Open",
          },
        },
        {
          key: "ghost:g",
          kind: "ghost",
          group: "base",
          id: "g",
          name: "g",
          meta: "",
          date: null,
        },
      ],
    });
    expect(placed).toEqual([]);
  });

  it("uses one map, or two in Side-by-side", () => {
    expect(mapsFor("single")).toEqual(["single"]);
    expect(mapsFor("swipe")).toEqual(["single"]);
    expect(mapsFor("side")).toEqual(["left", "right"]);
  });
});
