import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("3D viewer dependencies (foundation F0)", () => {
  it("pins potree-core, three and its types exactly: a three upgrade can break potree-core", () => {
    expect(pkg.dependencies["potree-core"]).toBe("2.0.15");
    expect(pkg.dependencies.three).toBe("0.180.0");
    expect(pkg.devDependencies["@types/three"]).toBe("0.180.0");
  });
});
