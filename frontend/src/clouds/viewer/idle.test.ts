import { describe, expect, it } from "vitest";
import { IDLE_AFTER_MS, shouldKeepRendering } from "./idle";

const base = { nodesLoading: 0, pendingLoads: 0, lastActivityAt: 0, now: 5000, hidden: false };

describe("idle render loop", () => {
  it("renders while nodes load or within a second of activity", () => {
    expect(shouldKeepRendering({ ...base, nodesLoading: 2 })).toBe(true);
    expect(shouldKeepRendering({ ...base, pendingLoads: 1 })).toBe(true);
    expect(shouldKeepRendering({ ...base, lastActivityAt: base.now - IDLE_AFTER_MS + 1 })).toBe(true);
  });

  it("stops when idle and whenever the document is hidden", () => {
    expect(shouldKeepRendering(base)).toBe(false);
    expect(shouldKeepRendering({ ...base, nodesLoading: 5, hidden: true })).toBe(false);
  });
});
