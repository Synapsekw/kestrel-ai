import { describe, expect, it } from "vitest";
import { survey } from "../test/fixtures";
import { canCompare, flownDates, stepSurvey } from "./surveys";

const S = [
  survey("2026-09-14"),
  survey("2026-08-14"),
  survey("2026-08-14", { note: "a second map that day" }),
  survey("2026-10-14", { planned: true }),
];

describe("survey dates (spec §14 Dates)", () => {
  it("lists flown dates once each, oldest first, without planned ones", () => {
    expect(flownDates(S)).toEqual(["2026-08-14", "2026-09-14"]);
    expect(canCompare(S)).toBe(true);
    expect(canCompare([survey("2026-08-14"), survey("2026-10-14", { planned: true })])).toBe(false);
  });

  it("steps r and refuses to cross the floor (L < R)", () => {
    const d = ["2026-07-01", "2026-08-14", "2026-09-14"];
    expect(stepSurvey(d, "2026-08-14", 1, null)).toBe("2026-09-14");
    expect(stepSurvey(d, "2026-09-14", 1, null)).toBeNull();
    expect(stepSurvey(d, "2026-08-14", -1, null)).toBe("2026-07-01");
    expect(stepSurvey(d, "2026-08-14", -1, "2026-07-01")).toBeNull();
    expect(stepSurvey(d, null, 1, null)).toBe("2026-07-01");
    expect(stepSurvey([], null, 1, null)).toBeNull();
  });
});
