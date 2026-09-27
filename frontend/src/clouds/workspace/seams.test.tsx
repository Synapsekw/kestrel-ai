import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SEAMS, WorkspaceSeamsContext, useWorkspaceSeams, type WorkspaceSeams } from "./seams";

function Probe() {
  const s = useWorkspaceSeams();
  s.requestViewCapture({ kind: "finding", id: "f1" }, "create");
  return (
    <output>
      {s.ReportViewCard ? "card" : "no card"} · {s.LikelyViews ? "views" : "no views"}
    </output>
  );
}

describe("workspace seams (controller ruling 1)", () => {
  it("defaults to a no-op capture and no components", () => {
    render(<Probe />);
    expect(screen.getByRole("status")).toHaveTextContent("no card · no views");
    expect(DEFAULT_SEAMS.ReportViewCard).toBeNull();
  });

  it("hands the provider's implementations to every consumer", () => {
    const request = vi.fn();
    const seams: WorkspaceSeams = {
      requestViewCapture: request,
      ReportViewCard: () => <p>card</p>,
      LikelyViews: null,
    };
    render(
      <WorkspaceSeamsContext.Provider value={seams}>
        <Probe />
      </WorkspaceSeamsContext.Provider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("card · no views");
    expect(request).toHaveBeenCalledWith({ kind: "finding", id: "f1" }, "create");
  });
});
