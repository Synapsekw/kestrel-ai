import { readFileSync } from "node:fs";
const css = readFileSync("src/index.css", "utf8");
import { describe, expect, it } from "vitest";

function luminance(name: string) {
  const triplet = css.match(new RegExp(`--${name}:\\s*(\\d+) (\\d+) (\\d+);`));
  expect(triplet, `Missing palette role: ${name}`).not.toBeNull();
  const values = triplet!.slice(1).map((v) => {
    const s = Number(v) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
describe("Contour role contrast", () => {
  it.each([
    ["ink", "ground"],
    ["muted", "panel"],
    ["muted", "well"],
    ["accent-fg", "accent"],
    ["accent-fg", "accent-hover"],
    ["accent-ink", "accent-soft"],
    ["ok", "ok-soft"],
    ["warn", "warn-soft"],
    ["danger", "danger-soft"],
  ])("keeps %s readable on %s", (foreground, background) => {
    const a = luminance(foreground),
      b = luminance(background);
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
  it.each([
    ["control-line", "panel"],
    ["control-line", "well"],
    ["accent", "panel"],
  ])("keeps %s controls distinct on %s", (foreground, background) => {
    const a = luminance(foreground),
      b = luminance(background);
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(3);
  });
});
