import { describe, expect, it } from "vitest";
import { getAnchorNormal, setAnchorNormal } from "./normals";

describe("anchor normals", () => {
  it("stores a copy per id and clears it with null", () => {
    const n: [number, number, number] = [0, 1, 0];
    setAnchorNormal("f1", n);
    n[0] = 9; // the caller's array is not kept
    expect(getAnchorNormal("f1")).toEqual([0, 1, 0]);
    setAnchorNormal("f1", null);
    expect(getAnchorNormal("f1")).toBeNull();
    expect(getAnchorNormal("never-set")).toBeNull();
  });
});
