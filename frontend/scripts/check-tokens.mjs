// Fails when a source file uses a raw Tailwind palette colour instead of a design token
// (DESIGN.md). `src/ui/tokens.ts` is the one file allowed to.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const bad =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|decoration|divide|placeholder|shadow|accent)-(?:slate|orange|emerald|amber|red|sky|gray|zinc|neutral|stone|green|yellow|blue|indigo|violet|purple|pink|rose|teal|cyan|lime)-\d{2,3}\b/;
const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    if (!/\.(tsx?|css)$/.test(name)) continue;
    if (p.replace(/\\/g, "/").endsWith("src/ui/tokens.ts")) continue;
    readFileSync(p, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (bad.test(line)) hits.push(`${p}:${i + 1}: ${line.trim()}`);
      });
  }
}

walk("src");
if (hits.length) {
  console.error(`${hits.length} raw palette classes:\n${hits.join("\n")}`);
  process.exit(1);
}
console.log("tokens ok");
