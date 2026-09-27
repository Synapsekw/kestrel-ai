import { describe, expect, it } from "vitest";
import { flownDates } from "../state/surveys";
import { survey } from "../test/fixtures";
import { AUG, JUL, OCT, SEP, surveyMap, surveySurface } from "../test/rasterFixtures";
import {
  buildTicks,
  clickTick,
  formatSurveyDate,
  pickDate,
  rangeText,
  summaryText,
} from "./timelineModel";

const surveys = [
  survey(SEP),
  survey(AUG),
  survey(OCT, { planned: true }),
  survey(JUL),
];
const ticks = buildTicks(surveys);
const dates = flownDates(surveys);

describe("buildTicks", () => {
  it("sorts by date, positions by time and keeps planned ticks apart", () => {
    expect(ticks.map((t) => t.date)).toEqual([JUL, AUG, SEP, OCT]);
    expect(ticks[0].pos).toBeCloseTo(0.04);
    expect(ticks[3].pos).toBeCloseTo(0.96);
    expect(ticks[1].pos).toBeGreaterThan(ticks[0].pos);
    expect(ticks[3].planned).toBe(true);
  });

  it("merges two items on one date into one tick (M §14)", () => {
    const merged = buildTicks([
      survey(AUG, { maps: [surveyMap("m1")] }),
      survey(AUG, { maps: [surveyMap("m2")], surfaces: [surveySurface("s1")] }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      mapIds: ["m1", "m2"],
      surfaceIds: ["s1"],
      pos: 0.5,
    });
  });

  it("a date both flown and planned counts as flown; an import date stays flagged", () => {
    const t = buildTicks([
      survey(AUG, { planned: true }),
      survey(AUG),
      survey(SEP, { date_is_import_date: true }),
    ]);
    expect(t[0].planned).toBe(false);
    expect(t[1].importDate).toBe(true);
  });

  it("is empty without surveys", () => {
    expect(buildTicks([])).toEqual([]);
  });
});

describe("selection rules (M §15)", () => {
  it("pickDate keeps L < R by moving the other date (W2-2)", () => {
    const pair = { l: JUL, r: AUG };
    expect(pickDate(pair, "l", AUG, dates, true)).toEqual({ l: AUG, r: SEP });
    expect(pickDate(pair, "l", SEP, dates, true)).toBeNull();
    expect(pickDate({ l: AUG, r: SEP }, "r", AUG, dates, true)).toEqual({
      l: JUL,
      r: AUG,
    });
    expect(pickDate({ l: AUG, r: SEP }, "r", JUL, dates, true)).toBeNull();
    expect(pickDate(pair, "r", OCT, dates, true)).toBeNull(); // planned
    expect(pickDate(pair, "r", JUL, dates, false)).toEqual({ l: JUL, r: JUL });
    expect(pickDate(pair, "l", JUL, dates, false)).toBeNull();
  });

  it("clickTick moves the nearer marker in compare, sets R in Single, ignores planned (W2-3)", () => {
    const pair = { l: JUL, r: SEP };
    const aug = ticks[1];
    expect(clickTick(pair, aug, ticks, false)).toEqual({ l: JUL, r: AUG });
    const nearerIsL =
      Math.abs(aug.pos - ticks[0].pos) < Math.abs(aug.pos - ticks[2].pos);
    expect(clickTick(pair, aug, ticks, true)).toEqual(
      nearerIsL ? { l: AUG, r: SEP } : { l: JUL, r: AUG },
    );
    expect(clickTick(pair, ticks[3], ticks, true)).toBeNull();
  });
});

describe("text", () => {
  it("formats dates, the range and the summary", () => {
    expect(formatSurveyDate(SEP)).toBe("14 Sep 2026");
    expect(formatSurveyDate(SEP, true)).toBe("14 Sep");
    expect(formatSurveyDate(null)).toBe("date not set");
    expect(rangeText({ l: AUG, r: SEP }, true)).toBe(
      "14 Aug → 14 Sep · 31 days",
    );
    expect(rangeText({ l: AUG, r: SEP }, false)).toBe("14 Sep 2026");
    expect(rangeText({ l: null, r: null }, false)).toBe("No surveys yet");
    expect(summaryText(ticks)).toBe("Survey timeline · 3 flights, 1 planned");
    expect(summaryText(buildTicks([survey(AUG)]))).toBe(
      "Survey timeline · 1 flight",
    );
  });
});
