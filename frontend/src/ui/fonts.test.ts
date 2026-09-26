import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/index.css", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
const vite = readFileSync("vite.config.ts", "utf8");

describe("bundled fonts", () => {
  it("imports Space Grotesk and JetBrains Mono from the installed packages and nothing from Google", () => {
    expect(css).toContain('@import "@fontsource-variable/space-grotesk";');
    expect(css).toContain('@import "@fontsource-variable/jetbrains-mono";');
    expect(css).not.toMatch(/instrument-sans|googleapis|gstatic/i);
  });

  it("depends on the two packages and no longer on Instrument Sans", () => {
    expect(pkg.dependencies).toHaveProperty("@fontsource-variable/space-grotesk");
    expect(pkg.dependencies).toHaveProperty("@fontsource-variable/jetbrains-mono");
    expect(pkg.dependencies).not.toHaveProperty("@fontsource-variable/instrument-sans");
  });

  it("never lets Vite inline a font as data: (the packaged CSP blocks data: fonts)", () => {
    expect(vite).toMatch(/assetsInlineLimit:[^\n]*woff2/);
  });
});
