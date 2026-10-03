import { afterEach, describe, expect, it } from "vitest";
import { SPLIT_DEFAULT, SPLIT_KEY, SPLIT_MAX, SPLIT_MIN, clampSplit, readSplit, splitFromKey, splitFromPointer, writeSplit } from "./split";

afterEach(() => localStorage.clear());

describe("split", () => {
  it("keeps the asset stage between 22 and 75 % of the width", () => {
    expect([SPLIT_MIN, SPLIT_MAX, SPLIT_DEFAULT]).toEqual([22, 75, 50]);
    expect(clampSplit(10)).toBe(22);
    expect(clampSplit(90)).toBe(75);
    expect(clampSplit(Number.NaN)).toBe(50);
  });

  it("moves by keys", () => {
    expect(splitFromKey(50, "ArrowLeft", false)).toBe(48);
    expect(splitFromKey(50, "ArrowRight", true)).toBe(60);
    expect(splitFromKey(74, "ArrowRight", true)).toBe(75);
    expect(splitFromKey(50, "Home", false)).toBe(22);
    expect(splitFromKey(50, "End", false)).toBe(75);
    expect(splitFromKey(50, "a", false)).toBeNull();
  });

  it("follows the pointer across the screen's width", () => {
    expect(splitFromPointer(600, 100, 1000)).toBe(50);
    expect(splitFromPointer(0, 100, 1000)).toBe(22);
  });

  it("remembers the split, and ignores garbage", () => {
    expect(readSplit()).toBe(50);
    writeSplit(63);
    expect(localStorage.getItem(SPLIT_KEY)).toBe("63");
    expect(readSplit()).toBe(63);
    localStorage.setItem(SPLIT_KEY, "banana");
    expect(readSplit()).toBe(50);
  });
});
