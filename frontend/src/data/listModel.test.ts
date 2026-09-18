import { describe, it, expect } from "vitest";
import { exampleImage, exampleImage2 } from "@/test/fixtures";
import {
  applyClientFilters,
  DATA_COLUMNS,
  DEFAULT_FILTERS,
  DEFAULT_QUERY,
  formatCaptureTime,
  keyboardAction,
  REVIEW_COLUMNS,
  toggleSort,
  toImageParams,
} from "./listModel";

describe("toImageParams", () => {
  it("sends only the server-side filters that are set", () => {
    expect(toImageParams(DEFAULT_QUERY, 200)).toEqual({ sort: "path", order: "asc", limit: 200 });
    const q = {
      filters: {
        ...DEFAULT_FILTERS,
        search: "0031",
        sourceId: "s",
        groupKey: "g",
        labeled: "yes" as const,
        pending: "no" as const,
        minBoxes: 2,
      },
      sort: "box_count" as const,
      order: "desc" as const,
    };
    expect(toImageParams(q, 50, "abc")).toEqual({
      sort: "box_count",
      order: "desc",
      limit: 50,
      cursor: "abc",
      search: "0031",
      source_id: "s",
      group_key: "g",
      labeled: true,
      has_pending: false,
    });
  });
});

describe("applyClientFilters", () => {
  it("filters by minimum box count and capture date range", () => {
    const items = [exampleImage, exampleImage2];
    expect(applyClientFilters(items, DEFAULT_FILTERS)).toHaveLength(2);
    expect(applyClientFilters(items, { ...DEFAULT_FILTERS, minBoxes: 1 }).map((i) => i.id)).toEqual([
      exampleImage.id,
    ]);
    expect(
      applyClientFilters(items, { ...DEFAULT_FILTERS, captureFrom: "2019-04-15", captureTo: "2019-04-15" }),
    ).toHaveLength(2);
    expect(applyClientFilters(items, { ...DEFAULT_FILTERS, captureFrom: "2019-04-16" })).toHaveLength(0);
    expect(
      applyClientFilters([{ ...exampleImage, capture_time: null }], {
        ...DEFAULT_FILTERS,
        captureTo: "2019-04-14",
      }),
    ).toHaveLength(0);
  });
});

describe("toggleSort / columns / formatting / keyboard", () => {
  it("flips the order on the same key and resets to asc on a new key", () => {
    const q1 = toggleSort(DEFAULT_QUERY, "path");
    expect(q1).toMatchObject({ sort: "path", order: "desc" });
    expect(toggleSort(q1, "capture_time")).toMatchObject({ sort: "capture_time", order: "asc" });
  });

  it("renders the seven data columns and the review columns", () => {
    expect(DATA_COLUMNS.map((c) => c.label)).toEqual([
      "File",
      "Source",
      "Group",
      "Labeled",
      "Boxes",
      "Pending",
      "Captured",
    ]);
    const ctx = { sourceNames: { [exampleImage.source_id]: "ahmadia" } };
    expect(DATA_COLUMNS.map((c) => c.render(exampleImage, ctx))).toEqual([
      "IX-12-02491_0031_0001.jpg",
      "ahmadia",
      "IX-12-02491_0031",
      "yes",
      3,
      2,
      "2019-04-15 06:35",
    ]);
    expect(DATA_COLUMNS[1].render(exampleImage, { sourceNames: {} })).toBe("50000000");
    expect(REVIEW_COLUMNS.map((c) => c.label)).toEqual([
      "File",
      "Group",
      "Pending",
      "Top confidence",
      "Boxes",
    ]);
    expect(REVIEW_COLUMNS[3].render(exampleImage, ctx)).toBe("81%");
    expect(REVIEW_COLUMNS[3].render(exampleImage2, ctx)).toBe("");
    expect(formatCaptureTime(null)).toBe("");
  });

  it("maps list keys", () => {
    const k = (key: string, ctrl = false) => keyboardAction({ key, ctrlKey: ctrl, metaKey: false });
    expect(k("j")).toEqual({ type: "move", delta: 1 });
    expect(k("K")).toEqual({ type: "move", delta: -1 });
    expect(k("ArrowDown")).toEqual({ type: "move", delta: 1 });
    expect(k("Enter")).toEqual({ type: "open" });
    expect(k(" ")).toEqual({ type: "toggle" });
    expect(k("a", true)).toEqual({ type: "select-all" });
    expect(k("Escape")).toEqual({ type: "clear" });
    expect(k("x")).toBeNull();
  });
});
