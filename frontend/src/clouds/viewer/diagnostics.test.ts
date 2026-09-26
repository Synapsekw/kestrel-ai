import { afterEach, describe, expect, it } from "vitest";
import {
  classifyPixels,
  diagnosticsEnabled,
  DIAGNOSTICS_KEY,
  installHook,
  MAX_ERRORS,
  pushErrorOnce,
  type CloudViewerDiagnostics,
} from "./diagnostics";

function hook(): CloudViewerDiagnostics {
  return {
    stats: () => {
      throw new Error("unused");
    },
    sampleColours: () => ({ total: 0, background: 0, red: 0, green: 0, white: 0 }),
    pickCenter: () => null,
    pickDown: () => null,
    overlays: () => [],
  };
}

describe("diagnostics hook ownership", () => {
  afterEach(() => {
    delete window.__kestrelCloudViewer;
  });

  it("installs a frozen hook and removes only its own", () => {
    const releaseOld = installHook(hook());
    const installed = window.__kestrelCloudViewer;
    expect(Object.isFrozen(installed)).toBe(true);
    const releaseNew = installHook(hook());
    const current = window.__kestrelCloudViewer;
    expect(current).not.toBe(installed);
    releaseOld(); // an older viewer's cleanup running after the new one mounted
    expect(window.__kestrelCloudViewer).toBe(current);
    releaseNew();
    expect(window.__kestrelCloudViewer).toBeUndefined();
  });
});

describe("viewer error list", () => {
  it("records a failure once, and never more than the cap", () => {
    const errors: string[] = [];
    for (let i = 0; i < 100; i++) pushErrorOnce(errors, "a node failed to load");
    expect(errors).toEqual(["a node failed to load"]);
    for (let i = 0; i < 100; i++) pushErrorOnce(errors, `e${i}`);
    expect(errors).toHaveLength(MAX_ERRORS);
  });
});

describe("diagnostics", () => {
  it("is off unless the flag is exactly 1", () => {
    expect(diagnosticsEnabled({ getItem: () => "1" })).toBe(true);
    expect(diagnosticsEnabled({ getItem: () => "true" })).toBe(false);
    expect(diagnosticsEnabled({ getItem: () => null })).toBe(false);
    expect(
      diagnosticsEnabled({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(false);
    expect(DIAGNOSTICS_KEY).toBe("kestrel.diagnostics");
  });

  it("counts background, red, green and pure-white pixels", () => {
    const px = (r: number, g: number, b: number) => [r, g, b, 255];
    const rgba = new Uint8Array([
      ...px(21, 27, 25), // background (canvas token)
      ...px(23, 28, 25), // background within tolerance
      ...px(200, 30, 30), // red
      ...px(30, 200, 40), // green
      ...px(255, 252, 250), // white
      ...px(120, 110, 100), // other
    ]);
    expect(classifyPixels(rgba, [21, 27, 25])).toEqual({
      total: 6,
      background: 2,
      red: 1,
      green: 1,
      white: 1,
    });
  });
});
