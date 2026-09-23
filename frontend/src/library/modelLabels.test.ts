import { describe, it, expect } from "vitest";
import { classMapping, formatDate, formatLocalDate, formatMetric, originLabel, taskLabel } from "./modelLabels";

describe("model labels", () => {
  it("formats metrics as percentages and dates as UTC minutes", () => {
    expect(formatMetric(0.71)).toBe("71.0%");
    expect(formatMetric(0.4444)).toBe("44.4%");
    expect(formatMetric(null)).toBe("–");
    expect(formatMetric(undefined)).toBe("–");
    expect(formatDate("2026-09-17T10:10:00Z")).toBe("2026-09-17 10:10");
    expect(originLabel("imported")).toBe("Imported");
    expect(originLabel("trained")).toBe("Trained");
    expect(originLabel("starter")).toBe("Starter");
    expect(taskLabel("detect")).toBe("Boxes");
    expect(taskLabel("obb")).toBe("Rotated boxes");
  });

  it("shows backend timestamps (UTC) in the machine's local time", () => {
    const tz = process.env.TZ;
    process.env.TZ = "Asia/Riyadh";
    try {
      expect(formatLocalDate("2026-09-19T05:06:00+00:00")).toBe("2026-09-19 08:06");
      expect(formatLocalDate("2026-09-18T22:30:00Z")).toBe("2026-09-19 01:30");
      expect(formatLocalDate("not a date")).toBe("not a date");
    } finally {
      process.env.TZ = tz;
    }
  });

  it("tells which of a model's classes reach the project, by name or by alias", () => {
    const coco = ["person", "car", "truck", "excavator"];
    expect(classMapping(coco, { truck: "dump_truck" }, ["excavator", "dump_truck", "crane"])).toEqual({
      mapped: [
        { from: "truck", to: "dump_truck" },
        { from: "excavator", to: "excavator" },
      ],
      ignored: 2,
    });
    // An alias to a class the project does not have maps nothing.
    expect(classMapping(["truck"], { truck: "lorry" }, ["crane"])).toEqual({ mapped: [], ignored: 1 });
  });
});
