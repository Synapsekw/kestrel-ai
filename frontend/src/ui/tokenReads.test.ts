import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/index.css", "utf8");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("tokens read from JavaScript", () => {
  it("are RGB triplets in index.css, so canvas, WebGL and OpenLayers colours never turn NaN", () => {
    const names = new Set<string>();
    for (const file of sources("src")) {
      for (const m of readFileSync(file, "utf8").matchAll(/token(?:Rgb|Colour)\(\s*["']([a-z-]+)["']/g)) {
        names.add(m[1]);
      }
    }
    // Read through variables rather than literals: CloudViewer's overlay tones, labelLayers' MATCH_TOKEN.
    for (const name of ["accent", "ok", "warn", "danger", "ink"]) names.add(name);
    expect(names.size).toBeGreaterThan(5);
    for (const name of names) {
      expect(css, `--${name}`).toMatch(new RegExp(`(?<![\\w-])--${name}:\\s*\\d+ \\d+ \\d+;`));
    }
  });
});
