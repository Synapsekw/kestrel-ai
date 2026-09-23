import { describe, expect, it } from "vitest";
import { chartLines } from "./chartPoints";
import { exampleTimeline } from "@/test/fixtures";

const size = { w: 400, h: 200 };

describe("chartLines", () => {
  it("draws one line per class, oldest survey on the left", () => {
    const lines = chartLines(exampleTimeline, size);
    expect(lines).toHaveLength(1);
    expect(lines[0].dots).toHaveLength(2);
    expect(lines[0].dots[0].x).toBeLessThan(lines[0].dots[1].x);
    // 12 then 15: a rising count draws upward, which is a smaller y in SVG coordinates.
    expect(lines[0].dots[0].y).toBeGreaterThan(lines[0].dots[1].y);
  });

  it("keeps every point inside the box", () => {
    for (const line of chartLines(exampleTimeline, size)) {
      for (const d of line.dots) {
        expect(d.x).toBeGreaterThanOrEqual(0);
        expect(d.x).toBeLessThanOrEqual(size.w);
        expect(d.y).toBeGreaterThanOrEqual(0);
        expect(d.y).toBeLessThanOrEqual(size.h);
      }
    }
  });

  it("marks a survey counted another way as not comparable", () => {
    const odd = {
      ...exampleTimeline,
      surveys: [
        exampleTimeline.surveys[0],
        { ...exampleTimeline.surveys[1], state: "not_comparable" as const },
      ],
    };
    expect(chartLines(odd, size)[0].dots.map((d) => d.comparable)).toEqual([true, false]);
  });

  it("a single survey still yields a drawable point", () => {
    const one = { ...exampleTimeline, surveys: [exampleTimeline.surveys[0]] };
    expect(chartLines(one, size)[0].dots).toHaveLength(1);
  });

  it("a survey with no count for a class sits on the floor rather than off the chart", () => {
    const missing = {
      ...exampleTimeline,
      surveys: [{ ...exampleTimeline.surveys[0], counts: {} }, exampleTimeline.surveys[1]],
    };
    const [line] = chartLines(missing, size);
    expect(line.dots[0].y).toBeLessThanOrEqual(size.h);
    expect(line.dots[0].y).toBeGreaterThan(line.dots[1].y);
  });
});
