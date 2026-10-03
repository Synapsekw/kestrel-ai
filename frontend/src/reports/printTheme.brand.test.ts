import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRINT_THEME, withBrand, type BrandOverlayInput } from "./printTheme";

interface Expected {
  colours: Record<string, string>;
  cover_gradient: string[];
  chart_palette: string[];
  fonts: Record<string, string>;
}
interface Case {
  name: string;
  brand: BrandOverlayInput | null;
  expected: Expected | null;
}

const VECTORS = resolve(__dirname, "../../../contract/fixtures/report-brand-overlay.json");
const CASES = (JSON.parse(readFileSync(VECTORS, "utf8")) as { cases: Case[] }).cases;
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("withBrand (spec 2026-10-02-asset-findings §5.8, the Python with_brand's twin)", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const before = plain(PRINT_THEME);
    const out = withBrand(PRINT_THEME, c.brand);
    expect(plain(PRINT_THEME)).toEqual(before);
    if (c.expected === null) {
      expect(out).toEqual(before);
      return;
    }
    expect({
      colours: out.colours,
      cover_gradient: out.cover.gradient,
      chart_palette: out.chart.palette,
      fonts: out.fonts,
    }).toEqual(c.expected);
    expect(out.type).toEqual(before.type);
    expect(out.brand).toEqual(before.brand);
  });
});
