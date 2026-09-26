// Fails when a source file bypasses the design system (DESIGN.md, "Aero glass").
// Usage: node scripts/check-tokens.mjs [root]   (root defaults to src)
// Every rule but raw-palette and motion-reduce-variant exempts <root>/ui/**, where the
// primitives live: raw-palette keeps its old exemption (src/ui/tokens.ts only), and
// motion-reduce-variant applies everywhere because Tailwind's built-in `motion-reduce`
// variant cannot be redefined by a plugin (controller ruling 2026-09-26) — `ui/` primitives
// must use the app's own `reduce-motion:` variant too.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const UTIL =
  "(?:bg|text|border|ring|ring-offset|from|to|via|fill|stroke|outline|decoration|divide|placeholder|shadow|caret)";
const RETIRED = "(?:ground|side|panel|well|canvas|accent-line|accent-hover|warn-strong|inverse-fg|inverse)";
const TRANSLUCENT =
  "(?:surface-2|surface|field|hover|rail|glass-line|glass|line-strong|line|card-line|accent-soft|ok-soft|danger-soft|warn-soft)";
const inUi = (rel) => rel.startsWith("ui/");

const RULES = [
  {
    id: "raw-palette",
    why: "use a design token, not a raw Tailwind palette colour",
    re: /\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|decoration|divide|placeholder|shadow|accent)-(?:slate|orange|emerald|amber|red|sky|gray|zinc|neutral|stone|green|yellow|blue|indigo|violet|purple|pink|rose|teal|cyan|lime)-\d{2,3}\b/,
    exempt: (rel) => rel === "ui/tokens.ts",
  },
  {
    id: "arbitrary-colour",
    why: "tokens only; a colour from data goes through --c on a style prop",
    re: /\b(?:bg|text|border|ring|fill|stroke|from|to|via)-\[(?:#|rgba?\(|hsla?\()/,
    exempt: inUi,
  },
  {
    id: "rgba-in-classname",
    why: "tokens only; no rgba() inside className",
    re: /className=.*rgba\(/,
    exempt: inUi,
  },
  {
    id: "backdrop",
    why: "blur lives in GlassPanel (spec F7)",
    re: /\bbackdrop-(?:blur|filter|saturate)|backdropFilter/,
    exempt: inUi,
  },
  {
    id: "motion",
    why: "use duration-fast|base|slow|emphasis|count, ease-out|spring|in-out and .stagger",
    re: /\b(?:duration-\d+|ease-\[|delay-\d+)/,
    exempt: inUi,
  },
  {
    id: "arbitrary-shape",
    why: "use the radius, type and elevation tokens",
    re: /\b(?:rounded(?:-[trblse]{1,2})?-\[|font-\[|shadow-\[)/,
    exempt: inUi,
  },
  {
    id: "retired-token",
    why: "a Contour token that Aero glass removed (DESIGN.md, Colour)",
    re: new RegExp(`\\b${UTIL}-${RETIRED}\\b|--${RETIRED}\\b|token(?:Rgb|Colour)\\(\\s*["']${RETIRED}["']`),
    exempt: inUi,
  },
  {
    id: "translucent-modifier",
    why: "a translucent token is a complete rgba(); Tailwind drops the class when given an opacity modifier",
    re: new RegExp(`\\b${UTIL}-${TRANSLUCENT}\\/\\d+`),
    exempt: inUi,
  },
  {
    id: "motion-reduce-variant",
    why: "Tailwind's built-in motion-reduce: variant can't be redefined by a plugin; use reduce-motion: (tailwind.config.ts), which also honours the Settings override",
    re: /\bmotion-reduce:/,
    exempt: () => false,
  },
];

const root = process.argv[2] ?? "src";
const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    // Skip *.test.ts(x): checkTokens.test.ts's own fixtures deliberately spell out violation
    // strings (e.g. "bg-slate-500") as JS literals for the checker to run against isolated temp
    // dirs; scanning the test file itself as a source line would flag the checker against itself.
    if (!/\.(tsx?|css)$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
    const rel = relative(root, path).replace(/\\/g, "/");
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const rule of RULES) {
          if (rule.exempt(rel) || !rule.re.test(line)) continue;
          hits.push(`${rel}:${i + 1}: [${rule.id}] ${line.trim()}  (${rule.why})`);
        }
      });
  }
}

walk(root);
if (hits.length) {
  console.error(`${hits.length} design-system violations:\n${hits.join("\n")}`);
  process.exit(1);
}
console.log("tokens ok");
