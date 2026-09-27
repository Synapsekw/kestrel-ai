import { describe, expect, it } from "vitest";
import {
  applyPreset,
  DEFAULT_BROWSER_FILTERS,
  filtersToIndexQuery,
  moreFilterCount,
  toggleSeverity,
  type BrowserFilterState,
} from "./filters";

const f = (over: Partial<BrowserFilterState>): BrowserFilterState => ({
  ...DEFAULT_BROWSER_FILTERS,
  ...over,
});

describe("browser filters → index query", () => {
  it("sends only sort, order and geo by default", () => {
    expect(filtersToIndexQuery(DEFAULT_BROWSER_FILTERS)).toEqual({
      sort: "capture_time",
      order: "asc",
      fields: "geo",
    });
  });

  it("maps every filter to its query parameter", () => {
    expect(
      filtersToIndexQuery(
        f({
          sourceId: "s1",
          hasFindings: true,
          findingStatus: "open",
          severities: [2, 4],
          typeIds: ["t2", "t1"],
          hasSuggestions: true,
          reviewed: "no",
          unlabeled: true,
          search: "  0031 ",
          sort: "worst_severity",
          order: "desc",
        }),
      ),
    ).toEqual({
      sort: "worst_severity",
      order: "desc",
      fields: "geo",
      source_id: "s1",
      has_findings: true,
      finding_status: "open",
      severity: "4,2",
      type_ids: "t1,t2",
      has_suggestions: true,
      reviewed: false,
      unlabeled: true,
      search: "0031",
    });
  });

  it("serialises the same filters to the same query whatever the selection order", () => {
    const a = filtersToIndexQuery(f({ severities: [1, 3], typeIds: ["b", "a"] }));
    const b = filtersToIndexQuery(f({ severities: [3, 1], typeIds: ["a", "b"] }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("reviewed yes is true, all is absent", () => {
    expect(filtersToIndexQuery(f({ reviewed: "yes" })).reviewed).toBe(true);
    expect("reviewed" in filtersToIndexQuery(f({ reviewed: "all" }))).toBe(false);
  });

  it("toggles a severity chip on and off", () => {
    const on = toggleSeverity(DEFAULT_BROWSER_FILTERS, 3);
    expect(on.severities).toEqual([3]);
    expect(toggleSeverity(on, 3).severities).toEqual([]);
  });

  it("the suggestions preset (the old /review) sorts by suggestion confidence", () => {
    expect(applyPreset("suggestions")).toEqual(
      f({ hasSuggestions: true, sort: "max_pending_confidence", order: "desc" }),
    );
    expect(applyPreset("nonsense")).toEqual(DEFAULT_BROWSER_FILTERS);
    expect(applyPreset(null)).toEqual(DEFAULT_BROWSER_FILTERS);
  });

  it("counts the filters hidden under More", () => {
    expect(moreFilterCount(DEFAULT_BROWSER_FILTERS)).toBe(0);
    expect(moreFilterCount(f({ typeIds: ["a"], unlabeled: true, search: "x", reviewed: "yes" }))).toBe(4);
  });
});
