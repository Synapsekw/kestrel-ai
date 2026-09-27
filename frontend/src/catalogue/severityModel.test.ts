import { describe, expect, it } from "vitest";
import { exampleSeverity } from "@/test/appSectionFixtures";
import {
  MAX_LEVELS,
  appendLevel,
  removeTopLevel,
  severityInUseMessage,
  toLevels,
  validateLevels,
} from "./severityModel";

describe("severity scale edits (F §7.2)", () => {
  it("appends the next level with a name and a colour", () => {
    const next = appendLevel(exampleSeverity);
    expect(next).toHaveLength(5);
    expect(next[4]).toEqual({ level: 5, name: "Level 5", colour: "#c2185b" });
  });

  it("never grows beyond nine levels and never shrinks below one", () => {
    let levels = exampleSeverity;
    for (let i = 0; i < 10; i += 1) levels = appendLevel(levels);
    expect(levels).toHaveLength(MAX_LEVELS);
    let few = exampleSeverity;
    for (let i = 0; i < 10; i += 1) few = removeTopLevel(few);
    expect(few).toEqual([exampleSeverity[0]]);
  });

  it("refuses blank and duplicate names", () => {
    expect(validateLevels([{ ...exampleSeverity[0], name: " " }])).toBe("Give level 1 a name.");
    expect(validateLevels([exampleSeverity[0], { ...exampleSeverity[1], name: "minor" }])).toBe(
      'Two levels are called "minor". Give each level its own name.',
    );
    expect(validateLevels(exampleSeverity)).toBeNull();
  });

  it("trims names and numbers levels 1..n", () => {
    expect(toLevels([{ level: 7, name: " Low ", colour: "#3fb68e" }])).toEqual([
      { level: 1, name: "Low", colour: "#3fb68e" },
    ]);
  });

  it("names the level and the projects that still use it", () => {
    expect(severityInUseMessage({ level: 4, projects: ["Ahmadia", "Bridge A"] }, exampleSeverity)).toBe(
      "Level 4 (Critical) is still used by open findings in Ahmadia, Bridge A. Regrade or close them, then remove the level.",
    );
    expect(severityInUseMessage({ level: 4, projects: [] }, exampleSeverity)).toBe(
      "Level 4 (Critical) is still used by open findings in an open project. Regrade or close them, then remove the level.",
    );
  });
});
