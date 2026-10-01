import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson, specParam, type SnapshotSpec } from "./reports";

interface KeyCase {
  name: string;
  source_version: string;
  spec: SnapshotSpec;
  canonical: string;
  param: string;
  key: string;
}

const FIXTURE = resolve(__dirname, "../../../contract/fixtures/report-snapshot-keys.json");
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  renderer_version: string;
  cases: KeyCase[];
};
const { cases, renderer_version: rendererVersion } = fixture;

describe("snapshot spec parity with the backend (R3's fixture)", () => {
  it("has cases, including non-ASCII text", () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.some((c) => /\\u[0-9a-f]{4}/.test(c.canonical))).toBe(true);
  });

  // Ruling R-4: JavaScript writes integral numbers (3.0) and -0 exactly as Python does (3, 0), so
  // every case is checked for exact byte equality with R3's fixture, not just structural equality.
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    expect(canonicalJson(c.spec)).toBe(c.canonical);
    expect(specParam(c.spec)).toBe(c.param);
  });

  it.each(cases.map((c) => [c.name, c] as const))(
    "%s: key = sha256(canonical + source_version + renderer_version)",
    (_, c) => {
      const key = createHash("sha256")
        .update(`${c.canonical}\n${c.source_version}\n${rendererVersion}`)
        .digest("hex")
        .slice(0, 32);
      expect(key).toBe(c.key);
    },
  );
});
