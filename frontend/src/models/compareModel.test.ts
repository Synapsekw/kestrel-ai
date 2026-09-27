import { describe, expect, it } from "vitest";
import { exampleTrainingRun, exampleTrainingRun2 } from "@/test/appSectionFixtures";
import { compareProblem, epochSpan, overlayPolyline, readCompare } from "./compareModel";

const BOX = { width: 100, height: 60, pad: 10 };

describe("compare runs (F §12.4)", () => {
  it("asks for two to four runs, two of them with a model", () => {
    expect(compareProblem([exampleTrainingRun])).toBe("Choose two to four runs to compare.");
    expect(compareProblem([exampleTrainingRun, { ...exampleTrainingRun2, model_id: null }])).toBe(
      "At least two of the chosen runs need a finished model.",
    );
    expect(compareProblem(Array(5).fill(exampleTrainingRun))).toBe("Compare up to four runs at a time.");
    expect(compareProblem([exampleTrainingRun, exampleTrainingRun2])).toBeNull();
  });

  it("reads at most four ids from ?compare=", () => {
    expect(readCompare(new URLSearchParams("compare=a,b,c,d,e"))).toEqual(["a", "b", "c", "d"]);
    expect(readCompare(new URLSearchParams(""))).toEqual([]);
  });

  it("puts every series on one epoch axis", () => {
    const a = [1, 2, 3].map((epoch) => ({ epoch, map50: 0.5, map50_95: null }));
    const b = [1, 2, 3, 4, 5].map((epoch) => ({ epoch, map50: 1, map50_95: null }));
    const span = epochSpan([a, b]);
    expect(span).toEqual({ min: 1, max: 5 });
    expect(overlayPolyline(a, span!, BOX)).toBe("10,30 30,30 50,30");
    expect(overlayPolyline(b, span!, BOX).split(" ").pop()).toBe("90,10");
    expect(epochSpan([[], []])).toBeNull();
  });
});
