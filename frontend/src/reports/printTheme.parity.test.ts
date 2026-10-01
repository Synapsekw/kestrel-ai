import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRINT_THEME } from "./printTheme";

const FIXTURE = resolve(__dirname, "../../../contract/fixtures/report-theme.json");

describe("printTheme parity (spec §10.1 single source)", () => {
  it("is a literal copy of contract/fixtures/report-theme.json", () => {
    expect(JSON.parse(JSON.stringify(PRINT_THEME))).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });
});
