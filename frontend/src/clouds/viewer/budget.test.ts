import { describe, expect, it } from "vitest";
import { BUDGET_KEY, DEFAULT_BUDGET, readBudget, writeBudget } from "./budget";

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
    data,
  };
}

describe("point budget", () => {
  it("reads a stored budget and writes one back", () => {
    const s = memory({ [BUDGET_KEY]: "5000000" });
    expect(readBudget(s)).toBe(5_000_000);
    writeBudget(8_000_000, s);
    expect(s.data[BUDGET_KEY]).toBe("8000000");
  });

  it("falls back to 3 M on anything else", () => {
    expect(readBudget(memory())).toBe(DEFAULT_BUDGET);
    expect(readBudget(memory({ [BUDGET_KEY]: "4000000" }))).toBe(DEFAULT_BUDGET);
    expect(readBudget(memory({ [BUDGET_KEY]: "lots" }))).toBe(DEFAULT_BUDGET);
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("x");
      },
    };
    expect(readBudget(throwing)).toBe(DEFAULT_BUDGET);
    expect(() => writeBudget(1_000_000, throwing)).not.toThrow();
    expect(readBudget(null)).toBe(DEFAULT_BUDGET);
  });
});
