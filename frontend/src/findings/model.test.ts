import { describe, expect, it } from "vitest";
import { IMAGE_ID, MAP_ID, PROJECT_ID, SOURCE_ID } from "@/test/fixtures";
import { exampleFinding, exampleFinding2, FINDING_ID } from "@/test/findingFixtures";
import { formatFindingNumber, formatPercent, parseCreatedBy, relativeTime } from "./format";
import { canTransition } from "./status";
import { findingHref, findingPath, findingsTabPath } from "./links";
import {
  DEFAULT_FILTERS,
  filtersToQuery,
  filtersToSearch,
  findingsListPath,
  isFiltered,
  parseFilters,
} from "./filters";
import { findingLocation } from "./location";

const NOW = Date.parse("2026-09-26T12:00:00Z");

describe("format", () => {
  it("pads finding numbers to four digits and never truncates", () => {
    expect(formatFindingNumber(7)).toBe("F-0007");
    expect(formatFindingNumber(217)).toBe("F-0217");
    expect(formatFindingNumber(12345)).toBe("F-12345");
  });

  it("says how long ago, then falls back to a date", () => {
    expect(relativeTime("2026-09-26T11:59:40Z", NOW)).toBe("just now");
    expect(relativeTime("2026-09-26T11:48:00Z", NOW)).toBe("12 min ago");
    expect(relativeTime("2026-09-26T09:00:00Z", NOW)).toBe("3 h ago");
    expect(relativeTime("2026-09-25T10:00:00Z", NOW)).toBe("yesterday");
    expect(relativeTime("2026-09-22T12:00:00Z", NOW)).toBe("4 d ago");
    expect(relativeTime("2026-09-12T12:00:00Z", NOW)).toBe("12 Sep");
    expect(relativeTime("not a date", NOW)).toBe("");
  });

  it("reads who created a finding", () => {
    expect(parseCreatedBy("human")).toEqual({ kind: "human" });
    expect(parseCreatedBy("model:m-1")).toEqual({ kind: "model", modelId: "m-1" });
    expect(parseCreatedBy("model:")).toEqual({ kind: "human" });
  });

  it("formats confidence as a whole percent", () => {
    expect(formatPercent(0.874)).toBe("87%");
    expect(formatPercent(null)).toBeNull();
  });
});

describe("status transitions (F §8.2)", () => {
  it("refuses only closed → reviewed, and no-op moves", () => {
    expect(canTransition("open", "reviewed")).toBe(true);
    expect(canTransition("open", "closed")).toBe(true);
    expect(canTransition("reviewed", "open")).toBe(true);
    expect(canTransition("closed", "open")).toBe(true);
    expect(canTransition("closed", "reviewed")).toBe(false);
    expect(canTransition("open", "open")).toBe(false);
  });
});

describe("finding links (F §8.7)", () => {
  it("builds the canonical link and one workspace link per anchor", () => {
    expect(findingPath(PROJECT_ID, FINDING_ID)).toBe(`/p/${PROJECT_ID}/findings/${FINDING_ID}`);
    expect(findingHref(PROJECT_ID, exampleFinding)).toBe(
      `/p/${PROJECT_ID}/images/${IMAGE_ID}?finding=${FINDING_ID}`,
    );
    expect(findingHref(PROJECT_ID, exampleFinding2)).toBe(
      `/p/${PROJECT_ID}/maps?map=${MAP_ID}&finding=${exampleFinding2.id}`,
    );
    const cloud = {
      id: "f9",
      anchor: { kind: "cloud", cloud_id: "c1", x: 1, y: 2, z: 3, uncertainty_m: 0.1 },
    } as const;
    expect(findingHref(PROJECT_ID, cloud)).toBe(`/p/${PROJECT_ID}/clouds/c1?finding=f9`);
  });

  it("builds the Findings tab path, keeping a raw search as-is (F24)", () => {
    expect(findingsTabPath(PROJECT_ID)).toBe(`/p/${PROJECT_ID}/findings`);
    expect(findingsTabPath(PROJECT_ID, "")).toBe(`/p/${PROJECT_ID}/findings`);
    expect(findingsTabPath(PROJECT_ID, "?status=open&q=crack")).toBe(
      `/p/${PROJECT_ID}/findings?status=open&q=crack`,
    );
    expect(findingsTabPath(PROJECT_ID, "severity=4")).toBe(`/p/${PROJECT_ID}/findings?severity=4`);
    expect(findingsTabPath(PROJECT_ID, new URLSearchParams([["status", "closed"]]))).toBe(
      `/p/${PROJECT_ID}/findings?status=closed`,
    );
    expect(findingsTabPath(PROJECT_ID, new URLSearchParams())).toBe(`/p/${PROJECT_ID}/findings`);
  });
});

describe("filters ↔ URL ↔ query", () => {
  it("parses the URL, dropping unknown and malformed values", () => {
    const f = parseFilters(
      new URLSearchParams(
        "status=open&severity=4&severity=none&severity=x&type_id=t1&anchor_kind=map&anchor_kind=disk&q=crack&sort=bogus",
      ),
    );
    expect(f).toEqual({
      status: "open",
      severity: [4, "none"],
      typeIds: ["t1"],
      source: ["map"],
      q: "crack",
      sort: "-severity",
    });
    expect(parseFilters(new URLSearchParams("status=weird")).status).toBeNull();
  });

  it("round-trips and omits defaults", () => {
    const f = { ...DEFAULT_FILTERS, status: "reviewed" as const, severity: [3], sort: "number" as const };
    expect(filtersToSearch(f).toString()).toBe("status=reviewed&severity=3&sort=number");
    expect(parseFilters(filtersToSearch(f))).toEqual(f);
    expect(filtersToSearch(DEFAULT_FILTERS).toString()).toBe("");
  });

  it("turns filters into the API query", () => {
    expect(filtersToQuery({ ...DEFAULT_FILTERS, status: "open", source: ["image"], q: "  spall " })).toEqual({
      sort: "-severity",
      status: ["open"],
      anchor_kind: ["image"],
      q: "spall",
    });
  });

  it("knows when anything is filtered and builds pre-filtered links", () => {
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false);
    expect(isFiltered({ ...DEFAULT_FILTERS, q: "x" })).toBe(true);
    expect(isFiltered({ ...DEFAULT_FILTERS, sort: "number" })).toBe(false);
    expect(findingsListPath(PROJECT_ID, { status: "open", severity: [4] })).toBe(
      `/p/${PROJECT_ID}/findings?status=open&severity=4`,
    );
    expect(findingsListPath(PROJECT_ID, {})).toBe(`/p/${PROJECT_ID}/findings`);
  });
});

describe("finding location", () => {
  it("names the data item and, when the anchor has one, the file", () => {
    const labels = new Map([[SOURCE_ID, "Flight 14 Sep"]]);
    expect(findingLocation(exampleFinding, labels)).toEqual({
      icon: "images",
      primary: "Flight 14 Sep",
      secondary: null,
    });
    const withFile = { ...exampleFinding, anchor: { ...exampleFinding.anchor, file_name: "DJI_0412.JPG" } };
    expect(findingLocation(withFile, labels).secondary).toBe("DJI_0412.JPG");
    expect(findingLocation(exampleFinding2, new Map())).toEqual({
      icon: "map",
      primary: "Map",
      secondary: null,
    });
  });
});
