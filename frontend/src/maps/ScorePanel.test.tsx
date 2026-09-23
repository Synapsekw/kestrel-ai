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
        scoreErrors={{}}
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
        scoreErrors={{}}
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

  it("keeps the primary column pending until its own score arrives, even when a second run's score is already in", () => {
    // Both runs are ticked, but only the SECOND one's score has resolved. The primary (ticked-first)
    // column must show a pending state, not fall through to the second run's numbers, and the
    // stepper must stay disabled — never step through a comparison run's mistakes as if they were
    // the primary's.
    const onStep = vi.fn();
    render(
      <ScorePanel
        runs={[exampleMapRun, second]}
        selected={[exampleMapRun.id, "r2"]}
        scores={{ r2: exampleMapScore }}
        scoreErrors={{}}
        classes={exampleClasses}
        overlay
        onOverlay={() => {}}
        onStep={onStep}
      />,
    );
    const precisionCells = screen.getByRole("row", { name: "Precision" }).querySelectorAll("td");
    expect(precisionCells[1]).toHaveTextContent("scoring…");
    expect(precisionCells[2]).toHaveTextContent("90.0 %");
    expect(screen.queryByText("2 mistakes")).not.toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Next mistake" });
    const prev = screen.getByRole("button", { name: "Previous mistake" });
    expect(next).toBeDisabled();
    expect(prev).toBeDisabled();
    fireEvent.click(next);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("shows a failed primary score as failed, not as forever loading, while the other column keeps working", () => {
    // Both runs are ticked; the primary's score request rejected (`scores[id]` stays absent/null,
    // `scoreErrors[id]` carries why), while the comparison run's score came back fine. The primary
    // column must say it failed — never a permanent "scoring…" — and the stepper must stay disabled;
    // the comparison column must still render its real numbers.
    const onStep = vi.fn();
    render(
      <ScorePanel
        runs={[exampleMapRun, second]}
        selected={[exampleMapRun.id, "r2"]}
        scores={{ r2: exampleMapScore }}
        scoreErrors={{ [exampleMapRun.id]: "request failed with status 500" }}
        classes={exampleClasses}
        overlay
        onOverlay={() => {}}
        onStep={onStep}
      />,
    );
    const precisionCells = screen.getByRole("row", { name: "Precision" }).querySelectorAll("td");
    expect(precisionCells[1]).toHaveTextContent("failed");
    expect(precisionCells[1]).not.toHaveTextContent("scoring…");
    expect(precisionCells[2]).toHaveTextContent("90.0 %");
    expect(screen.getByText(/Could not score this run: request failed with status 500/)).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Next mistake" });
    const prev = screen.getByRole("button", { name: "Previous mistake" });
    expect(next).toBeDisabled();
    expect(prev).toBeDisabled();
    fireEvent.click(next);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("steps through mistakes", () => {
    const onStep = vi.fn();
    render(
      <ScorePanel
        runs={[exampleMapRun]}
        selected={[exampleMapRun.id]}
        scores={{ [exampleMapRun.id]: exampleMapScore }}
        scoreErrors={{}}
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
        scoreErrors={{}}
        classes={exampleClasses}
        overlay={false}
        onOverlay={() => {}}
        onStep={() => {}}
      />,
    );
    expect(screen.getByText(/Label a zone to score this run/)).toBeInTheDocument();
  });
});
