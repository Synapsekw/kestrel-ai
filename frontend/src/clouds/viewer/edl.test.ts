// frontend/src/clouds/viewer/edl.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EDL_OPTIONS, EDL_RENDERS_TO_TARGET, reducedEffects, watchEffects } from "./edl";

const potreeDir = resolve(__dirname, "../../../node_modules/potree-core");

describe("EDL (spec §3 C13, §7)", () => {
  afterEach(() => {
    delete document.documentElement.dataset.effects;
  });

  it("uses strength 1 and radius 1.4", () => {
    expect(EDL_OPTIONS).toEqual({ strength: 1, radius: 1.4 });
  });

  it("is off under F's reduced effects only", () => {
    expect(reducedEffects()).toBe(false);
    document.documentElement.dataset.effects = "full";
    expect(reducedEffects()).toBe(false);
    document.documentElement.dataset.effects = "reduced";
    expect(reducedEffects()).toBe(true);
  });

  it("follows a change of <html data-effects>", async () => {
    const seen = vi.fn();
    const stop = watchEffects(seen);
    document.documentElement.dataset.effects = "reduced";
    await vi.waitFor(() => expect(seen).toHaveBeenLastCalledWith(true));
    document.documentElement.dataset.effects = "full";
    await vi.waitFor(() => expect(seen).toHaveBeenLastCalledWith(false));
    stop();
    const calls = seen.mock.calls.length;
    document.documentElement.dataset.effects = "reduced";
    await Promise.resolve();
    expect(seen.mock.calls.length).toBe(calls);
  });

  // The evidence for plan Ruling 3, pinned against the installed package: EDLPass sets the canvas as
  // its target and composites to it, whatever target the caller set. If an upgrade changes either
  // line, this fails and the capture path (C-V2) must be re-checked.
  it("potree-core 2.0.15's EDLPass cannot render into a render target", () => {
    const pkg = JSON.parse(readFileSync(resolve(potreeDir, "package.json"), "utf8")) as { version: string };
    expect(pkg.version).toBe("2.0.15");
    const src = readFileSync(resolve(potreeDir, "dist/index.js"), "utf8");
    expect(src).toContain("this.screenPass.render(t,this.edlMaterial,null)");
    expect(src).toMatch(/const s=t\.getRenderTarget\(\),l=n\.layers\.mask;t\.setRenderTarget\(null\)/);
    expect(EDL_RENDERS_TO_TARGET).toBe(false);
  });
});
