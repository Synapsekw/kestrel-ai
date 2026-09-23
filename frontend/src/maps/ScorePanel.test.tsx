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

  it("steps through mistakes", () => {
    const onStep = vi.fn();
    render(
      <ScorePanel
        runs={[exampleMapRun]}
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
