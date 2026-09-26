import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NOTICES } from "./notices";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

describe("licence notices", () => {
  it("lists the nine components with full texts", () => {
    expect(NOTICES.map((n) => n.id)).toEqual([
      "potree-core",
      "three",
      "brotli-js",
      "potreeconverter",
      "laszip",
      "brotli",
      "nlohmann-json",
      "laspy",
      "lazrs",
    ]);
    for (const n of NOTICES) {
      expect(n.text.length, n.id).toBeGreaterThan(900);
      expect(n.licence && n.usedFor && n.version, n.id).toBeTruthy();
    }
  });

  it("carries the versions package.json pins", () => {
    expect(NOTICES.find((n) => n.id === "potree-core")!.version).toBe(pkg.dependencies["potree-core"]);
    expect(NOTICES.find((n) => n.id === "three")!.version).toBe(pkg.dependencies["three"]);
  });

  it("states how laszip is used", () => {
    expect(NOTICES.find((n) => n.id === "laszip")!.note).toContain(
      "loaded dynamically by PotreeConverter.exe",
    );
  });
});
