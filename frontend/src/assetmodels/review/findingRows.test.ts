// src/assetmodels/review/findingRows.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SEVERITY_SCALE } from "@/ui/severityScale";
import { ASSET_FINDINGS, REVIEW } from "@/test/assetFindingFixtures";
import {
  NO_FILTER,
  findingItem,
  findingsQuery,
  focusSettingsOf,
  heightText,
  isFiltered,
  sideOptions,
  zoneLabel,
  zoneOptions,
} from "./findingRows";

const review = REVIEW;

describe("finding rows", () => {
  it("builds the list query from the filter", () => {
    expect(findingsQuery(NO_FILTER)).toEqual({ sort: "-severity" });
    expect(
      findingsQuery({ severity: "2", typeId: "t", zone: "middle", side: "West", placed: "unplaced" }),
    ).toEqual({
      sort: "-severity",
      severity: ["2"],
      type_id: ["t"],
      zone: ["middle"],
      side: ["West"],
      placed: false,
    });
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ ...NO_FILTER, placed: "placed" })).toBe(true);
  });

  it("reads zone and side options from the profile", () => {
    expect(zoneOptions(review)).toEqual([
      { value: "podium", label: "Podium" },
      { value: "middle", label: "Middle" },
    ]);
    expect(sideOptions(review).map((o) => o.label)).toEqual(["North", "East", "South", "West"]);
    expect(zoneOptions(null)).toEqual([]);
    expect(zoneLabel(review, "middle")).toBe("Middle");
    expect(zoneLabel(review, "roof")).toBe("roof");
  });

  it("shows number, type, zone, side and height, and says when a finding is not placed", () => {
    const [placed, unplaced] = ASSET_FINDINGS;
    expect(findingItem(placed, "Crack", DEFAULT_SEVERITY_SCALE, review)).toEqual({
      id: "f1",
      label: "F-0042 · Crack",
      meta: "Middle · West · 12.4 m",
      swatch: "#e2bf2e",
    });
    expect(findingItem(unplaced, undefined, DEFAULT_SEVERITY_SCALE, review).meta).toBe("Not placed");
    expect(heightText(null)).toBeNull();
  });

  it("passes the profile's focus settings to the engine", () => {
    expect(focusSettingsOf(review)).toEqual({ frustum: [0.05, 0.125], oblique_deg: 20 });
    expect(focusSettingsOf(null)).toBeUndefined();
  });
});
