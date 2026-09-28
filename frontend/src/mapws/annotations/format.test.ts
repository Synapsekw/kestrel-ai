import { describe, expect, it } from "vitest";
import {
  formatArea,
  formatDate,
  formatFraction,
  formatHeight,
  formatLength,
  formatScale,
  liveLabel,
} from "./format";

describe("measurement formatting", () => {
  it("lengths: metres with 2 decimals, kilometres from 1 km", () => {
    expect(formatLength(48.2)).toBe("48.20 m");
    expect(formatLength(1500)).toBe("1.500 km");
    expect(formatLength(Number.NaN)).toBe("–");
  });

  it("areas: one decimal under 1 000 m², grouped whole square metres above", () => {
    expect(formatArea(12.34)).toBe("12.3 m²");
    expect(formatArea(1234.4)).toBe("1 234 m²");
    expect(formatArea(1000752.4)).toBe("1 000 752 m²");
  });

  it("heights, scale factors, fractions and dates", () => {
    expect(formatHeight(612.346)).toBe("612.35 m");
    expect(formatScale(0.999623)).toBe("0.99962");
    expect(formatFraction(0.123)).toBe("12%");
    expect(formatDate("2026-09-14")).toBe("14 Sep 2026");
    expect(formatDate(null)).toBe("date not set");
  });

  it("the live label is planar and says grid, or local in a local frame", () => {
    expect(
      liveLabel(
        "distance",
        [
          [0, 0],
          [30, 40],
          [30, 40],
        ],
        "crs",
      ),
    ).toBe("≈ 50.00 m grid");
    expect(
      liveLabel(
        "profile",
        [
          [0, 0],
          [30, 40],
        ],
        "local",
      ),
    ).toBe("≈ 50.00 m local");
    expect(liveLabel("distance", [[0, 0]], "crs")).toBeNull();
    const square = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(liveLabel("area", square, "crs")).toBe(
      "≈ 100.0 m² · perim 40.00 m grid",
    );
    expect(liveLabel("area", square.slice(0, 2), "crs")).toBeNull();
  });
});
