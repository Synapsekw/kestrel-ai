import { describe, expect, it } from "vitest";
import { classifyPixels, diagnosticsEnabled, DIAGNOSTICS_KEY } from "./diagnostics";

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
