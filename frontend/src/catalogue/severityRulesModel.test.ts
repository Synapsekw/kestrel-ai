import { describe, expect, it } from "vitest";
import { DEFAULT_SEVERITY_SCALE } from "@/ui";
import {
  MAX_RULES,
  moveRule,
  newRuleLevel,
  onScale,
  rulesOf,
  sameRules,
  toRules,
  validateRules,
  type RuleDraft,
} from "./severityRulesModel";

const THREE = DEFAULT_SEVERITY_SCALE.slice(0, 3);
const r = (when: string, severity: number): RuleDraft => ({ key: `k-${when}`, when, severity });
const whens = (ds: RuleDraft[]) => ds.map((d) => d.when);

describe("rulesOf / toRules", () => {
  it("gives each rule its own key and trims conditions on the way out", () => {
    const drafts = rulesOf([
      { when: "Wide", severity: 4 },
      { when: "Hairline", severity: 1 },
    ]);
    expect(whens(drafts)).toEqual(["Wide", "Hairline"]);
    expect(new Set(drafts.map((d) => d.key)).size).toBe(2);
    expect(toRules([r("  Wide ", 4)])).toEqual([{ when: "Wide", severity: 4 }]);
  });

  it("reads a missing list (an answer from before 0003) as no rules", () => {
    expect(rulesOf(undefined)).toEqual([]);
    expect(rulesOf(null)).toEqual([]);
  });
});

describe("sameRules", () => {
  const a = [
    { when: "A", severity: 1 },
    { when: "B", severity: 2 },
  ];

  it("compares order, trimmed condition and level", () => {
    expect(sameRules(a, [...a])).toBe(true);
    expect(sameRules(a, [{ when: " A ", severity: 1 }, a[1]])).toBe(true);
    expect(sameRules(a, [a[1], a[0]])).toBe(false);
    expect(sameRules(a, [a[0], { when: "B", severity: 3 }])).toBe(false);
    expect(sameRules(a, a.slice(0, 1))).toBe(false);
  });
});

describe("moveRule", () => {
  const list = [r("A", 1), r("B", 2), r("C", 3)];

  it("moves a rule and keeps the others in order", () => {
    expect(whens(moveRule(list, 2, 0))).toEqual(["C", "A", "B"]);
    expect(whens(moveRule(list, 0, 1))).toEqual(["B", "A", "C"]);
  });

  it("ignores a move past either end", () => {
    expect(whens(moveRule(list, 0, -1))).toEqual(["A", "B", "C"]);
    expect(whens(moveRule(list, 2, 3))).toEqual(["A", "B", "C"]);
  });
});

describe("levels", () => {
  it("knows which levels are on the scale", () => {
    expect(onScale(3, THREE)).toBe(true);
    expect(onScale(4, THREE)).toBe(false);
  });

  it("starts a new rule at the type's default severity when the scale has it, else the lowest level", () => {
    expect(newRuleLevel(3, DEFAULT_SEVERITY_SCALE)).toBe(3);
    expect(newRuleLevel(4, THREE)).toBe(1);
    expect(newRuleLevel(null, THREE)).toBe(1);
  });
});

describe("validateRules", () => {
  it("accepts up to eight filled rules on the scale", () => {
    expect(
      validateRules(
        Array.from({ length: MAX_RULES }, (_, i) => r(`c${i}`, 1)),
        THREE,
      ),
    ).toBeNull();
    expect(validateRules([], THREE)).toBeNull();
  });

  it("names the first problem by rule number", () => {
    expect(
      validateRules(
        Array.from({ length: 9 }, (_, i) => r(`c${i}`, 1)),
        THREE,
      ),
    ).toBe("Keep to 8 rules or fewer.");
    expect(validateRules([r("ok", 1), r("  ", 2)], THREE)).toBe(
      "Rule 2 needs a condition. Say when it applies, or remove it.",
    );
    expect(validateRules([r("x".repeat(201), 1)], THREE)).toBe("Keep rule 1 to 200 characters or fewer.");
    expect(validateRules([r("Wide", 4)], THREE)).toBe(
      "Rule 1 uses level 4, which is no longer on the severity scale. Choose another level.",
    );
  });
});
