import { describe, expect, it } from "vitest";
import type { AreaAnalytics } from "@/api/analytics";
import { AUG, LOCAL, MAP_AUG, MAP_SEP, SEP, UTM38 } from "@/mapws/test/w3Fixtures";
import { categoryOf, surveyCounts, zoneFilters, zoneLabel, zoneStyleKind, zonesRows } from "./categories";

const ZONE = "5a000000-aaaa-4000-8000-000000000001";

describe("zones", () => {
  it("a missing or unknown category reads as general (W3-2)", () => {
    expect(categoryOf({})).toBe("general");
    expect(categoryOf({ category: null })).toBe("general");
    expect(categoryOf({ category: "bogus" })).toBe("general");
    expect(categoryOf({ category: "exclusion" })).toBe("exclusion");
  });

  it("an exclusion is hatched warn with its name in capitals; the rest are dashed accent", () => {
    expect(zoneLabel({ name: "Crane exclusion · 35 m", category: "exclusion" })).toBe(
      "CRANE EXCLUSION · 35 M",
    );
    expect(zoneLabel({ name: "North laydown", category: "laydown" })).toBe("North laydown");
    expect(zoneStyleKind("exclusion")).toBe("hatched-warn");
    expect(zoneStyleKind("excavation")).toBe("dashed-accent");
  });

  it("per-survey counts sum the classes and skip surveys that do not cover the zone", () => {
    const analytics: AreaAnalytics = {
      areas: [{ id: ZONE, name: "North laydown" }],
      surveys: [
        {
          map_id: MAP_AUG,
          map_name: "August",
          captured_on: AUG,
          state: "ok",
          per_area: {
            [ZONE]: {
              partial: false,
              counts: {
                c1: { total: 5, verified: 5 },
                c2: { total: 2, verified: 1 },
              },
            },
          },
        },
        {
          map_id: MAP_SEP,
          map_name: "September",
          captured_on: SEP,
          state: "ok",
          per_area: {
            [ZONE]: {
              partial: true,
              counts: { c1: { total: 9, verified: 0 } },
            },
          },
        },
        {
          map_id: "x",
          map_name: "Elsewhere",
          captured_on: null,
          state: "ok",
          per_area: {},
        },
      ],
    };
    expect(surveyCounts(analytics, ZONE)).toEqual([
      { key: MAP_AUG, date: AUG, name: "August", total: 7, partial: false },
      { key: MAP_SEP, date: SEP, name: "September", total: 9, partial: true },
    ]);
    expect(surveyCounts(null, ZONE)).toEqual([]);
  });

  it("the row, its category filter from the row style, and the local frame", () => {
    expect(zoneFilters({})).toEqual({
      categories: ["general", "laydown", "exclusion", "excavation", "other"],
    });
    expect(zoneFilters({ categories: ["exclusion", "x"] })).toEqual({
      categories: ["exclusion"],
    });
    expect(zonesRows({ frame: UTM38 })[0]).toMatchObject({
      key: "zones:all",
      name: "Site areas & zones",
      meta: "Site areas",
    });
    expect(zonesRows({ frame: LOCAL })[0].meta).toBe("Unavailable in local metres");
  });
});
