import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { exampleClasses, exampleMapRun, exampleMapScore } from "@/test/fixtures";
import { ScorePanel } from "./ScorePanel";

const second = { ...exampleMapRun, id: "r2", model_name: "machinery-v4" };

describe("ScorePanel", () => {
  it("shows precision, recall, F1 and count error for each selected run", () => {
    render(
      <ScorePanel
        runs={[exampleMapRun, second]}
        selected={[exampleMapRun.id, "r2"]}
        scores={{
          [exampleMapRun.id]: exampleMapScore,
          r2: { ...exampleMapScore, overall: { ...exampleMapScore.overall, recall: 0.93 } },
        }}
        classes={exampleClasses}
        overlay
        onOverlay={() => {}}
        onStep={() => {}}
      />,
    );
    expect(screen.getByRole("row", { name: "Precision" })).toHaveTextContent("90.0 %");
    expect(screen.getByRole("row", { name: "Recall" })).toHaveTextContent("85.7 %");
    expect(screen.getByRole("row", { name: "Recall" })).toHaveTextContent("93.0 %");
    expect(screen.getByRole("row", { name: "Count error" })).toHaveTextContent("−1");
  });

  it("scores the run the operator ticked first, not whichever comes first in `runs`", () => {
    // `runs` lists `second` before `exampleMapRun`, but the operator ticked `exampleMapRun` first:
    // the primary column, the mistake count and the stepper must all follow tick order, matching
    // what the map overlay colours (MapsScreen derives its `matchOf` the same way).
    const onStep = vi.fn();
    const secondScore = {
      ...exampleMapScore,
      overall: { ...exampleMapScore.overall, precision: 0.5 },
      matches: [], // no mistakes at all for the run that is NOT ticked first
    };
    render(
      <ScorePanel
        runs={[second, exampleMapRun]}
        selected={[exampleMapRun.id, "r2"]}
        scores={{
          [exampleMapRun.id]: exampleMapScore,
          r2: secondScore,
        }}
        classes={exampleClasses}
        overlay
        onOverlay={() => {}}
        onStep={onStep}
      />,
    );
    // Primary column (the first data column, after the row label) reads the ticked-first run's
    // precision, not `second`'s.
    const precisionCells = screen.getByRole("row", { name: "Precision" }).querySelectorAll("td");
    expect(precisionCells[1]).toHaveTextContent("90.0 %");
    expect(precisionCells[2]).toHaveTextContent("50.0 %");
    // The mistake count and stepper come from the ticked-first run (2 mistakes), not `second` (0).
    expect(screen.getByText("2 mistakes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next mistake" }));
    expect(onStep).toHaveBeenLastCalledWith(expect.objectContaining({ id: "d2", match: "fp" }));
  });

  it("steps through mistakes", () => {
    const onStep = vi.fn();
    render(
      <ScorePanel
        runs={[exampleMapRun]}
        selected={[exampleMapRun.id]}
        scores={{ [exampleMapRun.id]: exampleMapScore }}
        classes={exampleClasses}
        overlay
        onOverlay={() => {}}
        onStep={onStep}
      />,
    );
    expect(screen.getByText("2 mistakes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next mistake" }));
    expect(onStep).toHaveBeenLastCalledWith(expect.objectContaining({ id: "d2", match: "fp" }));
    expect(screen.getByText("1 of 2 · false alarm: excavator")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next mistake" }));
    expect(screen.getByText("2 of 2 · missed: dump_truck")).toBeInTheDocument();
  });

  it("explains that scoring needs zones", () => {
    render(
      <ScorePanel
        runs={[exampleMapRun]}
        selected={[exampleMapRun.id]}
        scores={{ [exampleMapRun.id]: { ...exampleMapScore, has_zones: false } }}
        classes={exampleClasses}
        overlay={false}
        onOverlay={() => {}}
        onStep={() => {}}
      />,
    );
    expect(screen.getByText(/Label a zone to score this run/)).toBeInTheDocument();
  });
});
