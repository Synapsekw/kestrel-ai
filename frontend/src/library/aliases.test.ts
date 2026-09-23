import { describe, it, expect } from "vitest";
import { DEFAULT_ALIASES, formatAliases, parseAliases } from "./aliases";

describe("class aliases", () => {
  it("round-trips the default and accepts =, : and ->", () => {
    expect(formatAliases(DEFAULT_ALIASES)).toBe("truck=dump_truck");
    expect(parseAliases("truck=dump_truck")).toEqual(DEFAULT_ALIASES);
    expect(parseAliases("# comment\n\ntruck : dump_truck\ncar -> wheel_loader\nbad line\n")).toEqual({
      truck: "dump_truck",
      car: "wheel_loader",
    });
    expect(parseAliases("")).toEqual({});
  });
});
