import { describe, expect, it } from "vitest";
import {
  PRINT,
  PRINT_THEME,
  contentWidthMm,
  findingLabel,
  mm,
  mmVar,
  paperOf,
  pt,
  textStyle,
  tint,
} from "./printTheme";

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("printTheme", () => {
  it("sizes in printed millimetres through --mm", () => {
    expect(mm(170)).toBe("calc(var(--mm) * 170)");
    expect(pt(9.5)).toBe("calc(var(--mm) * 3.3514)");
    expect(mm(-18)).toBe("calc(var(--mm) * -18)");
  });

  it("knows both papers and their content width at 18 mm margins", () => {
    expect(paperOf("A4")).toEqual({ width_mm: 210, height_mm: 297 });
    expect(paperOf("Letter")).toEqual({ width_mm: 215.9, height_mm: 279.4 });
    expect(contentWidthMm("A4")).toBe(174);
    expect(contentWidthMm("Letter")).toBe(179.9);
  });

  it("scales a millimetre to the column, never above real size", () => {
    expect(mmVar("A4")).toBe("min(calc((100cqw - 48px) / 210), 1mm)");
    expect(mmVar("Letter")).toBe("min(calc((100cqw - 48px) / 215.9), 1mm)");
  });

  it("tints a data colour at 12 % and refuses anything but #rrggbb", () => {
    expect(tint("#FF9C3A")).toBe("rgba(255, 156, 58, 0.12)");
    expect(tint("#ff9c3a", 0.5)).toBe("rgba(255, 156, 58, 0.5)");
    expect(tint("red")).toBe("transparent");
  });

  it("writes finding numbers as F-0042", () => {
    expect(findingLabel(42)).toBe("F-0042");
    expect(findingLabel(12345)).toBe("F-12345");
    expect(findingLabel("F-0007")).toBe("F-0007");
  });

  it("gives body text the 9.5/13 pt rhythm in ink", () => {
    expect(textStyle(PRINT.size.body)).toEqual({
      fontSize: pt(9.5),
      lineHeight: pt(13),
      color: PRINT.ink,
    });
  });

  it("exposes the cover's subtitle size and logo chip for the cover block (Ruling R-6)", () => {
    expect(PRINT.size.coverSubtitle).toBe(PRINT_THEME.cover.subtitle_pt);
    expect(PRINT.logoChip).toEqual(PRINT_THEME.cover.logo_chip_mm);
  });

  it("keeps text colours at 4.5:1 and marks at 3:1 on white paper (spec §10.1)", () => {
    for (const c of [PRINT.ink, PRINT.muted, PRINT.accent, PRINT.danger])
      expect(contrast(c, PRINT.paper)).toBeGreaterThanOrEqual(4.5);
    for (const c of [PRINT.teal, PRINT.tone.good]) expect(contrast(c, PRINT.paper)).toBeGreaterThanOrEqual(3);
    // PRINT.ungraded is decoration: the word "Ungraded" beside the dot carries the meaning.
  });
});
