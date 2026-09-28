import { describe, expect, it } from "vitest";
import { measurementOf } from "@/test/cloudViewFixtures";
import { findingMarks, measurementMarks, measurementPoints } from "./marks";

const kinds = (m: ReturnType<typeof measurementMarks>) =>
  m[0].kind === "measurement" ? m[0].shapes.map((s) => s.kind) : [];

describe("capture marks", () => {
  it("draws a finding as one pin at its anchor", () => {
    expect(findingMarks([1, 2, 3])).toEqual([{ kind: "finding", at: [1, 2, 3] }]);
  });

  it("draws an area as its points and a closed outline", () => {
    const marks = measurementMarks(
      measurementOf("area", [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
      ]),
    );
    expect(kinds(marks)).toEqual(["points", "line"]);
    expect(marks[0].kind === "measurement" && marks[0].shapes[1]).toMatchObject({
      kind: "line",
      closed: true,
    });
  });

  it("draws a profile as its line and rings as their points only", () => {
    expect(
      kinds(
        measurementMarks(
          measurementOf("profile", [
            [0, 0, 0],
            [5, 0, 0],
          ]),
        ),
      ),
    ).toEqual(["points", "line"]);
    const rings = measurementOf(
      "vertical",
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 5],
        [1, 0, 5],
        [0, 1, 5],
      ],
      { method: "rings" },
    );
    expect(kinds(measurementMarks(rings))).toEqual(["points"]);
  });

  it("draws the S1 kinds exactly as the measure tool does", () => {
    expect(
      kinds(
        measurementMarks(
          measurementOf("distance", [
            [0, 0, 0],
            [3, 4, 0],
          ]),
        ),
      ),
    ).toEqual(["points", "line"]);
  });

  it("reads points as tuples", () => {
    expect(
      measurementPoints(
        measurementOf("distance", [
          [1, 2, 3],
          [4, 5, 6],
        ]),
      ),
    ).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });
});
