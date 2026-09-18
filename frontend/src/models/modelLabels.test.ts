import { describe, it, expect } from "vitest";
import { formatDate, formatMetric, kindLabel } from "./modelLabels";

describe("model labels", () => {
  it("formats metrics as percentages and dates as UTC minutes", () => {
    expect(formatMetric(0.71)).toBe("71.0%");
    expect(formatMetric(0.4444)).toBe("44.4%");
    expect(formatMetric(null)).toBe("–");
    expect(formatMetric(undefined)).toBe("–");
    expect(formatDate("2026-09-17T10:10:00Z")).toBe("2026-09-17 10:10");
    expect(kindLabel("imported")).toBe("Imported");
    expect(kindLabel("trained")).toBe("Trained");
  });
});
