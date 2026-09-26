import { describe, expect, it } from "vitest";
import { areaTimeline, countText, reviewText } from "./format";
import { AREA_1, AREA_2, DUMP, EXC, areaAnalytics, timeline } from "./fixtures";

describe("countText", () => {
  it("shows a total with its verified part", () => {
    expect(countText(6, 4, false)).toBe("6 (4 verified)");
    expect(countText(3, 0, false)).toBe("3 (0 verified)");
  });

  it("shows only the verified number when asked", () => {
    expect(countText(6, 4, true)).toBe("4");
  });

  it("uses a dash for nothing counted", () => {
    expect(countText(0, 0, false)).toBe("-");
  });
});

describe("reviewText", () => {
  it("reads as progress", () => {
    expect(reviewText({ total: 530, reviewed: 412 })).toBe("412 of 530 reviewed");
    expect(reviewText({ total: 0, reviewed: 0 })).toBe("nothing to review");
  });
});

describe("areaTimeline", () => {
  it("turns one area's counts into a survey timeline for the chart", () => {
    const t = areaTimeline(areaAnalytics, AREA_1, timeline.classes, false);
    expect(t.classes).toEqual(timeline.classes);
    expect(t.surveys.map((s) => s.counts)).toEqual([
      { [EXC]: 5, [DUMP]: 2 },
      { [EXC]: 7, [DUMP]: 3 },
    ]);
    expect(t.surveys.map((s) => s.state)).toEqual(["ok", "ok"]);
  });

  it("uses verified counts when asked", () => {
    const t = areaTimeline(areaAnalytics, AREA_1, timeline.classes, true);
    expect(t.surveys[1].counts).toEqual({ [EXC]: 6, [DUMP]: 3 });
  });

  it("leaves out the surveys whose map misses the area", () => {
    const t = areaTimeline(areaAnalytics, AREA_2, timeline.classes, false);
    expect(t.surveys.map((s) => s.map_name)).toEqual(["April survey"]);
  });
});
