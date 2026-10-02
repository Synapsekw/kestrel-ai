import { describe, expect, it } from "vitest";
import { groupParts } from "./groups";

describe("groupParts", () => {
  it("orders by GROUP_ORDER and drops empty groups", () => {
    const n = { group: "Nozzle" };
    const s = { group: "Shell" };
    expect(groupParts([n, s])).toEqual([
      ["Shell", [s]],
      ["Nozzle", [n]],
    ]);
  });

  it("appends unknown groups alphabetically after the known ones", () => {
    const z = { group: "Zeta" };
    const a = { group: "Alpha" };
    const o = { group: "Other" };
    expect(groupParts([z, a, o]).map(([g]) => g)).toEqual(["Other", "Alpha", "Zeta"]);
  });
});
