export const BUDGETS = [1_000_000, 2_000_000, 3_000_000, 5_000_000, 8_000_000] as const;
export const DEFAULT_BUDGET = 3_000_000;
export const BUDGET_KEY = "kestrel.clouds.pointBudget";

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem">;

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readBudget(storage: Reader | null = localStore()): number {
  try {
    const v = Number(storage?.getItem(BUDGET_KEY));
    return (BUDGETS as readonly number[]).includes(v) ? v : DEFAULT_BUDGET;
  } catch {
    return DEFAULT_BUDGET;
  }
}

export function writeBudget(n: number, storage: Writer | null = localStore()): void {
  try {
    storage?.setItem(BUDGET_KEY, String(n));
  } catch {
    // a private window or blocked storage: the budget just is not remembered
  }
}
