import { describe, expect, it } from "vitest";
import { normaliseName } from "./normaliseName";

describe("normaliseName (F §7.1)", () => {
  it.each([
    ["dump_truck", "dump truck"],
    ["Dump truck", "dump truck"],
    ["  Dump   truck ", "dump truck"],
    ["Dump-Truck", "dump truck"],
    ["dump__-truck", "dump truck"],
    ["Crack", "crack"],
    ["", ""],
  ])("%j becomes %j", (input, expected) => {
    expect(normaliseName(input)).toBe(expected);
  });
});
