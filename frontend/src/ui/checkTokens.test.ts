// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/check-tokens.mjs");
let root = "";

function check(files: Record<string, string>) {
  root = mkdtempSync(join(tmpdir(), "check-tokens-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return spawnSync(process.execPath, [script, root], { encoding: "utf8" });
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

const FAILING: Array<[string, string, string]> = [
  ["raw-palette", "screens/A.tsx", `export const A = () => <div className="bg-slate-500" />;`],
  ["arbitrary-colour", "screens/A.tsx", `export const A = () => <div className="bg-[#ff0000]" />;`],
  [
    "rgba-in-classname",
    "screens/A.tsx",
    `export const A = () => <div className="[background:rgba(0,0,0,.2)]" />;`,
  ],
  ["backdrop", "screens/A.tsx", `export const A = () => <div className="backdrop-blur-md" />;`],
  ["backdrop", "screens/a.css", `.x { backdrop-filter: blur(4px); }`],
  ["motion", "screens/A.tsx", `export const A = () => <div className="transition duration-300" />;`],
  [
    "motion",
    "screens/A.tsx",
    `export const A = () => <div className="delay-75 ease-[cubic-bezier(0,0,1,1)]" />;`,
  ],
  ["arbitrary-shape", "screens/A.tsx", `export const A = () => <div className="rounded-[12px]" />;`],
  [
    "arbitrary-shape",
    "screens/A.tsx",
    `export const A = () => <div className="shadow-[0_0_4px_black] font-[600]" />;`,
  ],
  ["retired-token", "screens/A.tsx", `export const A = () => <div className="bg-panel text-inverse-fg" />;`],
  ["retired-token", "screens/a.ts", `export const clear = tokenRgb("canvas");`],
  ["retired-token", "screens/a.css", `.x { color: rgb(var(--ground)); }`],
  ["translucent-modifier", "screens/A.tsx", `export const A = () => <div className="bg-surface/80" />;`],
  ["translucent-modifier", "screens/A.tsx", `export const A = () => <div className="border-line/50" />;`],
  [
    "motion-reduce-variant",
    "screens/A.tsx",
    `export const A = () => <div className="animate-pulse motion-reduce:animate-none" />;`,
  ],
];

describe("check-tokens", () => {
  it.each(FAILING)("fails %s in %s", (rule, file, source) => {
    const run = check({ [file]: `${source}\n` });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`[${rule}]`);
    expect(run.stderr).toContain(`${file}:1:`);
  });

  it("passes token-only code and exempts src/ui/**", () => {
    const run = check({
      "screens/Good.tsx": `export const G = () => <div className="bg-surface text-ink/60 duration-fast ease-out rounded-panel shadow-elev-1 border-line" />;\n`,
      "ui/Glass.tsx": `export const U = () => <div className="backdrop-blur-md bg-[#fff] duration-300 rounded-[3px] bg-surface/50" />;\n`,
    });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("tokens ok");
  });

  it("does not mistake test ids and prose that contain a retired word", () => {
    const run = check({
      "screens/Ids.tsx": `export const I = () => <div data-testid="map-panel" title="server-side" aria-label="cloud-canvas" />;\n`,
    });
    expect(run.status).toBe(0);
  });

  it("keeps the raw-palette exemption for ui/tokens.ts only", () => {
    const run = check({ "ui/Other.tsx": `export const O = () => <div className="bg-slate-500" />;\n` });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("[raw-palette]");
  });

  it("catches motion-reduce: even inside src/ui/** (Tailwind's own variant can't be redefined)", () => {
    const run = check({
      "ui/Other.tsx": `export const O = () => <div className="animate-reveal motion-reduce:animate-none" />;\n`,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("[motion-reduce-variant]");
    expect(run.stderr).toContain("reduce-motion:");
  });
});
