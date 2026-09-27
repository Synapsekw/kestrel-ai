import { forwardRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { fakeClient } from "@/test/fixtures";
import { useAiStore } from "./aiStore";
import { useImagesWorkspace, wsGet } from "./bridge";
import { SuggestionChip } from "./SuggestionChip";
import { SuggestionsLayer } from "./SuggestionsLayer";
import { ensureBuiltInTools } from "@/images/tools"; // I-FC
import { renderAi, resetAll, seedWorkspace, suggestion } from "./testing";

// FC's ShapeNode is FC's to test; here it only has to be handed the right props. drift.md Task 6:
// SuggestionsLayer mirrors FC's per-node interactivity, so its onPointerDown reads the click event
// (left button only); the mock passes one through.
vi.mock("@/images/canvas/ShapeLayer", () => ({
  ShapeNode: (p: {
    box: { id: string };
    variant: string;
    selected: boolean;
    interactive?: boolean;
    onPointerDown?: (
      id: string,
      e?: { evt: { button: number; shiftKey: boolean }; cancelBubble: boolean },
    ) => void;
  }) => (
    <div
      data-shape={p.box.id}
      data-variant={p.variant}
      data-selected={String(p.selected)}
      data-interactive={String(p.interactive)}
      onClick={() =>
        p.onPointerDown?.(p.box.id, { evt: { button: 0, shiftKey: false }, cancelBubble: false })
      }
    />
  ),
}));
// Ghost forwards a ref to react-konva's Line (SuggestionsLayer.tsx); forwardRef here avoids a
// "function components cannot be given refs" warning (the ref itself is unused by the mock).
vi.mock("react-konva", () => ({
  Line: forwardRef<HTMLDivElement, Record<string, unknown>>((p, ref) => (
    <div
      ref={ref}
      data-konva="line"
      data-name={String(p.name ?? "")}
      data-dash={JSON.stringify(p.dash ?? null)}
      data-stroke={String(p.stroke ?? "")}
      data-listening={String(p.listening)}
    />
  )),
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

  it("passes FC's interactive gate: off while a drawing tool is active or Space is held", () => {
    ensureBuiltInTools();
    seedWorkspace([suggestion("a", 0.9)]);
    render(<SuggestionsLayer />);
    const node = () => document.querySelector('[data-shape="a"]')!.getAttribute("data-interactive");
    expect(node()).toBe("true");
    act(() => wsGet().setTool("box"));
    expect(node()).toBe("false");
    act(() => wsGet().setTool("select"));
    expect(node()).toBe("true");
    act(() => useImagesWorkspace.setState({ spaceHeld: true }));
    expect(node()).toBe("false");
    act(() => useImagesWorkspace.setState({ spaceHeld: false }));
  });

  it("keeps an in-flight suggestion drawn as a held, non-interactive ghost until the answer", () => {
    vi.useFakeTimers();
    const box = suggestion("h", 0.9);
    seedWorkspace([box, suggestion("b", 0.8)]);
    render(<SuggestionsLayer />);
    act(() => {
      useAiStore.getState().markInFlight(["h"]);
      useAiStore.getState().addLeaving([{ box: wsGet().boxes.h, kind: "held", colour: null }]);
    });
    // No longer a target (no ShapeNode), but its outline stays: teal dash, and it does not time out.
    expect(document.querySelector('[data-shape="h"]')).toBeNull();
    expect(document.querySelector('[data-shape="b"]')!.getAttribute("data-selected")).toBe("true");
    act(() => vi.advanceTimersByTime(1000));
    const held = document.querySelector('[data-name="held h"]')!;
    expect(held.getAttribute("data-dash")).toBe("[8,4]");
    expect(held.getAttribute("data-listening")).toBe("false");
    // The answer replaces it with the fade, which then ends.
    act(() => useAiStore.getState().addLeaving([{ box: wsGet().boxes.h, kind: "reject", colour: null }]));
    expect(document.querySelector('[data-name="held h"]')).toBeNull();
    expect(document.querySelector('[data-name="leaving h"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(400));
    expect(document.querySelector('[data-name="leaving h"]')).toBeNull();
    vi.useRealTimers();
  });

  it("never draws a ghost from another image", () => {
    seedWorkspace([]);
    render(<SuggestionsLayer />);
    act(() =>
      useAiStore
        .getState()
        .addLeaving([{ box: suggestion("o", 0.9, { image_id: "other-image" }), kind: "held", colour: null }]),
    );
    expect(document.querySelector('[data-name="held o"]')).toBeNull();
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
