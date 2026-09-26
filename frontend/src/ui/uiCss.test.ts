import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ui = readFileSync("src/ui/ui.css", "utf8");
const index = readFileSync("src/index.css", "utf8");

describe("ui.css", () => {
  it("is imported by index.css", () => {
    expect(index).toContain('@import "./ui/ui.css";');
  });

  it("keeps backdrop-filter inside .glass-float only (spec F7)", () => {
    const blurring = ui.split("}").filter((rule) => /backdrop-filter:\s*blur/.test(rule));
    expect(blurring).toHaveLength(1);
    expect(blurring[0]).toContain(".glass-float {");
  });

  it("drops the blur and paints glass opaque under reduced effects", () => {
    expect(ui).toMatch(
      /:root\[data-effects="reduced"\] \.glass-float \{[^}]*backdrop-filter: none;[^}]*rgb\(var\(--glass-solid\)\)/,
    );
  });

  it("flattens the backdrop to one gradient and drops the glow under reduced effects", () => {
    const reduced = index.slice(index.indexOf(':root[data-effects="reduced"]'));
    const backdrop = reduced.match(/--backdrop:([^;]*);/)![1];
    expect(backdrop.match(/radial-gradient/g)).toHaveLength(1);
    expect(reduced).toMatch(/--glow-primary: 0 0 0 transparent;/);
  });

  it("caps the stagger at --stagger-max and beats the animate-* shorthand", () => {
    expect(ui).toContain(".stagger.stagger {");
    expect(ui).toContain("min(var(--i, 0), var(--stagger-max) - 1)");
  });

  it("stops every loop under reduced motion, by media query and by the Settings override", () => {
    for (const prefix of ["", ':root[data-motion="reduced"] ']) {
      expect(ui).toContain(`${prefix}.animate-shimmer::after`);
      expect(ui).toContain(`${prefix}.animate-indeterminate`);
    }
    expect(ui).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.animate-shimmer::after/);
  });

  it("animates only transform and opacity", () => {
    const keyframes = ui.match(/@keyframes[^{]+\{[\s\S]*?\}\s*\}/g) ?? [];
    expect(keyframes.length).toBeGreaterThanOrEqual(3);
    for (const k of keyframes) {
      const props = [...k.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      expect(
        props.every((p) => p === "transform" || p === "opacity"),
        k,
      ).toBe(true);
    }
  });
});
