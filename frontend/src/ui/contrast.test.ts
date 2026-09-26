import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/index.css", "utf8");
type Rgba = [number, number, number, number];

/** The first definition of `--name` in index.css: the base :root block, before any override. */
function token(name: string): Rgba {
  const m = css.match(new RegExp(`(?<![\\w-])--${name}:\\s*([^;]+);`));
  expect(m, `index.css has no --${name}`).not.toBeNull();
  const value = m![1].trim();
  const triplet = value.match(/^(\d+) (\d+) (\d+)$/);
  if (triplet) return [Number(triplet[1]), Number(triplet[2]), Number(triplet[3]), 1];
  const rgba = value.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  expect(rgba, `--${name} is neither an RGB triplet nor rgba(): ${value}`).not.toBeNull();
  return [Number(rgba![1]), Number(rgba![2]), Number(rgba![3]), Number(rgba![4])];
}

/** A translucent colour painted over an opaque one. */
function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + under[0] * (1 - a),
    top[1] * a + under[1] * (1 - a),
    top[2] * a + under[2] * (1 - a),
    1,
  ];
}

/** A surface as the eye sees it: composited over the app's solid base, --bg (spec §4.5). */
const seen = (name: string) => over(token(name), token("bg"));

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const TEXT: Array<[string, string]> = [
  ["ink", "bg"],
  ["ink", "surface"],
  ["ink", "surface-2"],
  ["ink", "field"],
  ["ink", "glass"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["muted", "surface-2"],
  ["muted", "field"],
  ["muted", "glass"],
  ["muted", "tip"],
  ["accent-ink", "accent-soft"],
  ["accent-ink", "surface"],
  ["ok", "ok-soft"],
  ["danger", "danger-soft"],
  ["warn", "warn-soft"],
  ["info", "surface"],
  ["tip-fg", "tip"],
  ["glass-ink", "glass-solid"],
  ["bg", "ok"],
  ["bg", "danger"],
  ["bg", "warn"],
  // White labels on the primary button, at both ends of its gradient (operator decision 2026-09-26).
  ["accent-fg", "primary-from"],
  ["accent-fg", "primary-to"],
];

const BOUNDARY: Array<[string, string]> = [
  ["accent", "bg"],
  ["accent", "surface"],
  ["accent", "field"],
  ["control-line", "bg"],
  ["control-line", "surface"],
  ["control-line", "field"],
  ["dim", "bg"],
  ["dim", "surface"],
  ["ok", "surface"],
  ["danger", "surface"],
  ["warn", "surface"],
  ["info", "surface"],
  ["accent-fg", "accent"], // the checkbox tick, a non-text mark
];

describe("Aero glass contrast, translucent surfaces composited over --bg", () => {
  it.each(TEXT)("text %s on %s reaches 4.5:1", (fg, bg) => {
    expect(contrast(token(fg), seen(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(BOUNDARY)("%s stays distinct on %s at 3:1", (fg, bg) => {
    expect(contrast(token(fg), seen(bg))).toBeGreaterThanOrEqual(3);
  });

  it("keeps opaque tokens as triplets and translucent ones as rgba()", () => {
    const opaque = [
      "bg",
      "ink",
      "muted",
      "dim",
      "accent",
      "accent-ink",
      "accent-fg",
      "primary-from",
      "primary-to",
      "ok",
      "danger",
      "warn",
    ];
    for (const name of [...opaque, "info", "tip", "tip-fg", "glass-ink", "glass-solid", "control-line"]) {
      expect(token(name)[3], name).toBe(1);
    }
    const translucent = ["surface", "surface-2", "field", "hover", "rail", "glass", "glass-line", "line"];
    for (const name of [
      ...translucent,
      "line-strong",
      "card-line",
      "accent-soft",
      "ok-soft",
      "danger-soft",
    ]) {
      expect(token(name)[3], name).toBeLessThan(1);
    }
    expect(token("warn-soft")[3]).toBeLessThan(1);
  });
});
