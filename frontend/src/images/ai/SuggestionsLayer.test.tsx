import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { fakeClient } from "@/test/fixtures";
import { useAiStore } from "./aiStore";
import { wsGet } from "./bridge";
import { SuggestionChip } from "./SuggestionChip";
import { SuggestionsLayer } from "./SuggestionsLayer";
import { renderAi, resetAll, seedWorkspace, suggestion } from "./testing";

// FC's ShapeNode is FC's to test; here it only has to be handed the right props. drift.md Task 6:
// SuggestionsLayer mirrors FC's per-node interactivity, so its onPointerDown reads the click event
// (left button only); the mock passes one through.
vi.mock("@/images/canvas/ShapeLayer", () => ({
  ShapeNode: (p: {
    box: { id: string };
    variant: string;
    selected: boolean;
    onPointerDown?: (
      id: string,
      e?: { evt: { button: number; shiftKey: boolean }; cancelBubble: boolean },
    ) => void;
  }) => (
    <div
      data-shape={p.box.id}
      data-variant={p.variant}
      data-selected={String(p.selected)}
      onClick={() =>
        p.onPointerDown?.(p.box.id, { evt: { button: 0, shiftKey: false }, cancelBubble: false })
      }
    />
  ),
}));
vi.mock("react-konva", () => ({
  Line: (p: Record<string, unknown>) => (
    <div
      data-konva="line"
      data-name={String(p.name ?? "")}
      data-dash={JSON.stringify(p.dash ?? null)}
      data-stroke={String(p.stroke ?? "")}
    />
  ),
}));

beforeEach(() => {
  resetAll();
});

describe("SuggestionsLayer", () => {
  it("hands visible suggestions to ShapeNode as suggestions, hides those below the threshold", () => {
    seedWorkspace([suggestion("hi", 0.9), suggestion("lo", 0.2)]);
    act(() => wsGet().setThreshold(0.5));
    render(<SuggestionsLayer />);
    expect(document.querySelector('[data-shape="hi"]')!.getAttribute("data-variant")).toBe("suggestion");
    expect(document.querySelector('[data-shape="hi"]')!.getAttribute("data-selected")).toBe("true"); // the target
    expect(document.querySelector('[data-shape="lo"]')).toBeNull();
  });

  it("focuses a suggestion that is clicked", () => {
    seedWorkspace([suggestion("a", 0.9), suggestion("b", 0.8)]);
    render(<SuggestionsLayer />);
    fireEvent.click(document.querySelector('[data-shape="b"]')!);
    expect(wsGet().focusedSuggestionId).toBe("b");
  });

  it("draws an accept ghost solid in the type colour, then removes it", () => {
    vi.useFakeTimers();
    seedWorkspace([]);
    render(<SuggestionsLayer />);
    act(() =>
      useAiStore.getState().addLeaving([{ box: suggestion("g", 0.9), kind: "accept", colour: "#ff9c3a" }]),
    );
    const ghost = document.querySelector('[data-name="leaving g"]')!;
    expect(ghost.getAttribute("data-dash")).toBe("null");
    expect(ghost.getAttribute("data-stroke")).toBe("#ff9c3a");
    act(() => vi.advanceTimersByTime(400));
    expect(document.querySelector('[data-name="leaving g"]')).toBeNull();
    vi.useRealTimers();
  });
});

describe("SuggestionChip", () => {
  it("labels the target with type, confidence and the A / X actions", async () => {
    seedWorkspace([suggestion("hi", 0.87)]);
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/boxes\/review$/,
        body: { updated: 1, finding_ids_created: [], finding_ids_deleted: [] },
      },
    ]);
    renderAi(<SuggestionChip />, api);
    expect(screen.getByText("87%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
    await act(async () => {});
    expect(requests.find((r) => r.url.endsWith("/boxes/review"))?.body).toEqual({
      box_ids: ["hi"],
      action: "reject",
    });
  });

  it("renders nothing without suggestions or while the canvas pans", () => {
    seedWorkspace([]);
    const { api } = fakeClient([]);
    const { container } = renderAi(<SuggestionChip />, api);
    expect(container.textContent).toBe("");
    act(() => {
      seedWorkspace([suggestion("hi", 0.9)]);
      wsGet().setInteracting(true);
    });
    expect(container.textContent).toBe("");
  });
});
