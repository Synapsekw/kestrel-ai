// frontend/src/clouds/viewer/pixels.test.ts
import { describe, expect, it } from "vitest";
import { flipRows, splitHalves } from "./pixels";

describe("pixel helpers", () => {
  it("flips a bottom-up read-back to top-down rows", () => {
    // 1 x 3 image: rows (bottom to top) 1, 2, 3
    const src = Uint8Array.from([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
    expect(Array.from(flipRows(src, 1, 3))).toEqual([3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1]);
  });

  it("splits an image into its west and east halves", () => {
    // 2 x 1: a red pixel then a green one
    const { left, right } = splitHalves(Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1);
    expect(Array.from(left)).toEqual([255, 0, 0, 255]);
    expect(Array.from(right)).toEqual([0, 255, 0, 255]);
  });
});
