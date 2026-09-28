import { describe, expect, it } from "vitest";
import { DEFAULT_SEVERITY_SCALE } from "@/ui";
import { LOCAL, UTM38 } from "@/mapws/test/w3Fixtures";
import { findingFilters, findingsMeta, findingsRows, tooltipLine, visibleFindings } from "./tooltip";

const pin = (
  id: string,
  severity: number | null,
  status: "open" | "reviewed" | "closed",
  created_by = "human",
) => ({
  id,
  number: Number(id.slice(1)),
  type_id: "t",
  severity,
  status,
  created_by,
  map_id: "m",
  geometry_site: { type: "Point" as const, coordinates: [0, 0] },
});
const all = {
  allSurveys: false,
  statuses: ["open", "reviewed", "closed"],
  minSeverity: null,
};

describe("findings on the map", () => {
  it("the tooltip line: number, provenance and status (mockup 'F-0031 · AI + reviewed')", () => {
    expect(tooltipLine(pin("f31", 4, "reviewed", "model:m0000000"))).toBe("F-0031 · AI + reviewed");
    expect(tooltipLine(pin("f2", null, "open"))).toBe("F-0002 · Manual + open");
  });

  it("filters by status and a minimum severity", () => {
    const pins = [pin("f1", 4, "open"), pin("f2", 2, "closed"), pin("f3", null, "open")];
    expect(visibleFindings(pins, { ...all, statuses: ["open"] }).map((x) => x.id)).toEqual(["f1", "f3"]);
    expect(
      visibleFindings(pins, {
        ...all,
        statuses: ["open", "closed"],
        minSeverity: 2,
      }).map((x) => x.id),
    ).toEqual(["f1", "f2"]);
  });

  it("the live count names the top level (spec §5.2 '47 · 5 critical')", () => {
    const pins = [pin("f1", 4, "open"), pin("f2", 4, "open"), pin("f3", 2, "open"), pin("f4", null, "open")];
    expect(findingsMeta(pins, false, DEFAULT_SEVERITY_SCALE)).toBe("4 in view · 2 critical");
    expect(findingsMeta(pins.slice(2), false, DEFAULT_SEVERITY_SCALE)).toBe("2 in view");
    expect(findingsMeta(pins, true, DEFAULT_SEVERITY_SCALE)).toBe("4+ in view · 2 critical");
    expect(findingsMeta([], false, DEFAULT_SEVERITY_SCALE)).toBe("None in view");
  });

  it("reads its filters from the row style with safe defaults (W3-9)", () => {
    expect(findingFilters({})).toEqual(all);
    expect(
      findingFilters({
        allSurveys: true,
        statuses: ["open", "x"],
        minSeverity: 3,
      }),
    ).toEqual({
      allSurveys: true,
      statuses: ["open"],
      minSeverity: 3,
    });
  });

  it("is one row, unavailable in a local frame", () => {
    expect(findingsRows({ frame: UTM38 })[0]).toMatchObject({
      key: "findings:all",
      name: "Findings",
      meta: "Points and outlines",
    });
    // M-W3 A5: W1's LOCAL frame, not a test-local literal.
    expect(findingsRows({ frame: LOCAL })[0].meta).toBe("Unavailable in local metres");
  });
});
