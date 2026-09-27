import { afterEach, describe, expect, it, vi } from "vitest";
import { rememberedType, rememberType } from "./typeMemory";

afterEach(() => vi.restoreAllMocks());

describe("type memory", () => {
  it("remembers a type per tool per project", () => {
    rememberType("p1", "box", "t1");
    rememberType("p1", "polygon", "t2");
    rememberType("p2", "box", "t9");
    expect(rememberedType("p1", "box")).toBe("t1");
    expect(rememberedType("p1", "polygon")).toBe("t2");
    expect(rememberedType("p2", "box")).toBe("t9");
    expect(rememberedType("p3", "box")).toBeNull();
  });

  it("survives a storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => rememberType("p", "box", "t")).not.toThrow();
    expect(rememberedType("p", "box")).toBeNull();
  });
});
