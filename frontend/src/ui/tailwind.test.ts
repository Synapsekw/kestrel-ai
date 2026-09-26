// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import type { Config } from "tailwindcss";
import { describe, expect, it } from "vitest";

async function generate(classes: string): Promise<string> {
  // Loaded by URL so the app's tsconfig does not pull the node-side config into its program.
  const url = pathToFileURL(resolve("tailwind.config.ts")).href;
  const config = ((await import(/* @vite-ignore */ url)) as { default: Config }).default;
  const result = await postcss([
    tailwindcss({ ...config, content: [{ raw: `<div class="${classes}"></div>`, extension: "html" }] }),
  ]).process("@tailwind utilities;", { from: undefined });
  return result.css;
}

describe("the Aero glass Tailwind theme", () => {
  it("exposes colour, gradient, radius, elevation and type tokens as utilities", async () => {
    const css = await generate(
      "bg-surface text-ink/50 rounded-panel shadow-elev-1 bg-grad-primary text-kpi font-mono ring-offset-bg",
    );
    expect(css).toContain("background-color: var(--surface)");
    expect(css).toContain("rgb(var(--ink) / 0.5)");
    expect(css).toContain("border-radius: var(--r-panel)");
    expect(css).toContain("var(--elev-1)");
    expect(css).toContain("background-image: var(--grad-primary)");
    expect(css).toMatch(/font-size: 30px;[\s\S]*letter-spacing: -0.02em/);
    expect(css).toContain("JetBrains Mono Variable");
    expect(css).toContain("--tw-ring-offset-color: rgb(var(--bg)");
  });

  it("maps durations and easings to the motion tokens", async () => {
    const css = await generate("duration-emphasis ease-out animate-rise");
    expect(css).toContain("transition-duration: var(--dur-emphasis)");
    expect(css).toContain("transition-timing-function: var(--ease-out)");
    expect(css).toContain("animation: rise var(--dur-slow) var(--ease-out) backwards");
  });

  it("lets entrances end without a lasting effect, so glass inside them keeps its blur", async () => {
    // A finished `both` fill keeps the opacity animation applied, which makes the element a backdrop
    // root: a Dialog or CommandPalette inside its fading overlay would lose its frosted blur.
    const css = await generate("animate-reveal animate-rise animate-fade animate-pop animate-slide-in");
    const fills = [...css.matchAll(/animation: [\w-]+ var\(--dur-\w+\) var\(--ease-[\w-]+\) (\w+)/g)];
    expect(fills.map((m) => m[1])).toEqual(Array(5).fill("backwards"));
  });

  it("makes reduce-motion: honour the Settings override as well as the media query", async () => {
    const css = await generate("reduce-motion:animate-none");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(':root[data-motion="reduced"] .reduce-motion\\:animate-none');
  });

  it("gives reduced effects a reduce-effects: variant keyed on <html data-effects>", async () => {
    const css = await generate("reduce-effects:shadow-none");
    expect(css).toContain(':root[data-effects="reduced"] .reduce-effects\\:shadow-none');
  });

  it("drops every hand-made glow in the primitives under reduced effects (spec §4.3)", () => {
    const dir = resolve("src/ui");
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx") && !f.includes(".test."))) {
      for (const [n, line] of readFileSync(resolve(dir, file), "utf8").split("\n").entries()) {
        const glow = /(^|[\s"'`])shadow-\[/.test(line);
        const dropped = /(^|[\s"'`])reduce-effects:shadow-none([\s"'`]|$)/.test(line);
        if (glow && !dropped) offenders.push(`${file}:${n + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
