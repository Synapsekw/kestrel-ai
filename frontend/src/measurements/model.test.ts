import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  filtersToQuery,
  filtersToSearch,
  formatHeadline,
  isFiltered,
  kindIcon,
  kindText,
  parseFilters,
  statusView,
  subKindLabel,
  subKindOptions,
} from "./model";
import { measurementHref, measurementsTabPath, volumeViewPath } from "./links";

const sp = (s: string) => new URLSearchParams(s);

describe("filters", () => {
  it("reads kind and sub-kind from the URL", () => {
    expect(parseFilters(sp("kind=map&sub_kind=area"))).toEqual({
      kind: "map",
      subKind: "area",
    });
  });

  it("ignores an unknown kind and a sub-kind without a kind", () => {
    expect(parseFilters(sp("kind=drone&sub_kind=area"))).toEqual(DEFAULT_FILTERS);
    expect(parseFilters(sp("sub_kind=area"))).toEqual(DEFAULT_FILTERS);
  });

  it("keeps an unknown sub-kind so it can be shown", () => {
    expect(parseFilters(sp("kind=cloud&sub_kind=slope_angle")).subKind).toBe("slope_angle");
  });

  it("writes only what is set, and round-trips", () => {
    expect(filtersToSearch(DEFAULT_FILTERS).toString()).toBe("");
    const f = { kind: "cloud" as const, subKind: "height" };
    expect(filtersToSearch(f).toString()).toBe("kind=cloud&sub_kind=height");
    expect(parseFilters(filtersToSearch(f))).toEqual(f);
  });

  it("builds the API query", () => {
    expect(filtersToQuery(DEFAULT_FILTERS)).toEqual({});
    expect(filtersToQuery({ kind: "map", subKind: null })).toEqual({
      kind: ["map"],
    });
    expect(filtersToQuery({ kind: "map", subKind: "profile" })).toEqual({
      kind: ["map"],
      sub_kind: ["profile"],
    });
  });

  it("says whether anything is filtered", () => {
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false);
    expect(isFiltered({ kind: "volume", subKind: null })).toBe(true);
  });

  it("offers the known sub-kinds per kind, plus the current unknown one", () => {
    expect(subKindOptions("map", null)).toEqual(["distance", "area", "profile"]);
    expect(subKindOptions("cloud", null)).toEqual([
      "point",
      "distance",
      "height",
      "vertical",
      "area",
      "profile",
    ]);
    expect(subKindOptions("volume", null)).toEqual([]);
    expect(subKindOptions("all", null)).toEqual([]);
    expect(subKindOptions("cloud", "slope_angle").at(-1)).toBe("slope_angle");
  });
});

describe("labels", () => {
  it("names known and unknown sub-kinds", () => {
    expect(subKindLabel("vertical")).toBe("Verticality");
    expect(subKindLabel("area")).toBe("Area");
    expect(subKindLabel("slope_angle")).toBe("Slope angle");
    expect(subKindLabel(null)).toBe("");
  });

  it("joins kind and sub-kind, without repeating a volume", () => {
    expect(kindText({ kind: "map", sub_kind: "distance" })).toBe("Map · Distance");
    expect(kindText({ kind: "cloud", sub_kind: "slope_angle" })).toBe("Point cloud · Slope angle");
    expect(kindText({ kind: "volume", sub_kind: "volume" })).toBe("Volume");
    expect(kindText({ kind: "survey_line", sub_kind: null })).toBe("Survey line");
  });

  it("picks an icon per kind, with a generic one for the unknown", () => {
    expect(kindIcon("map")).toBe("map");
    expect(kindIcon("cloud")).toBe("cloud");
    expect(kindIcon("volume")).toBe("volume");
    expect(kindIcon("survey_line")).toBe("measure");
  });
});

describe("formatHeadline", () => {
  it("formats a number with its unit and thin grouping", () => {
    expect(formatHeadline(1234.5, "m3")).toBe("1 234.5 m³");
    expect(formatHeadline(12.3456, "m")).toBe("12.35 m");
    expect(formatHeadline(80, "m2")).toBe("80 m²");
    expect(formatHeadline(2.5, "deg")).toBe("2.5°");
    expect(formatHeadline(4, "mm_per_m")).toBe("4 mm/m");
    expect(formatHeadline(3, null)).toBe("3");
  });

  it("shows a dash for a missing or non-finite value", () => {
    expect(formatHeadline(null, "m")).toBe("—");
    expect(formatHeadline(undefined, "m")).toBe("—");
    expect(formatHeadline(Number.NaN, "m")).toBe("—");
  });

  it("shows a unit it does not know as it came", () => {
    expect(formatHeadline(7, "ft")).toBe("7 ft");
  });
});

describe("statusView", () => {
  it("maps the known statuses of every provider", () => {
    expect(statusView("ready")).toEqual({
      label: "Ready",
      tone: "ok",
      live: false,
    });
    expect(statusView("stale")).toEqual({
      label: "Stale",
      tone: "warn",
      live: false,
    });
    expect(statusView("calculating")).toEqual({
      label: "Calculating",
      tone: "accent",
      live: true,
    });
    expect(statusView("computing")).toEqual({
      label: "Computing",
      tone: "accent",
      live: true,
    });
    expect(statusView("failed")).toEqual({
      label: "Failed",
      tone: "danger",
      live: false,
    });
  });

  it("shows an unknown or missing status neutrally", () => {
    expect(statusView("queued_for_review")).toEqual({
      label: "Queued for review",
      tone: "neutral",
      live: false,
    });
    expect(statusView(null)).toEqual({
      label: "—",
      tone: "neutral",
      live: false,
    });
  });
});

describe("links", () => {
  it("opens each kind where it was measured", () => {
    expect(measurementHref("p", { kind: "map", id: "m1", data_id: "a1" })).toBe(
      "/p/p/maps?sel=measurement:m1",
    );
    expect(measurementHref("p", { kind: "cloud", id: "c9", data_id: "c1" })).toBe("/p/p/clouds/c1");
    expect(measurementHref("p", { kind: "cloud", id: "c9", data_id: null })).toBe("/p/p/clouds");
    expect(measurementHref("p", { kind: "volume", id: "v1", data_id: "s1" })).toBe(
      "/p/p/measurements/volumes/v1",
    );
    expect(measurementHref("p", { kind: "survey_line", id: "x", data_id: null })).toBeNull();
  });

  it("names the volume view and the tab", () => {
    expect(volumeViewPath("p")).toBe("/p/p/measurements/volumes");
    expect(volumeViewPath("p", "v1")).toBe("/p/p/measurements/volumes/v1");
    expect(measurementsTabPath("p")).toBe("/p/p/measurements");
  });
});
