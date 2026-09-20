import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditorCanvas } from "./EditorCanvas";
import { useEditorStore } from "@/store/editor";
import { exampleImage } from "@/test/fixtures";

// jsdom has no canvas, and the pan handler lives on the container div rather than the stage —
// so the Konva tree only has to render, not draw.
vi.mock("react-konva", () => {
  const node =
    (tag: string) =>
    (props: { children?: React.ReactNode }): React.ReactElement => (
      <div data-konva={tag}>{props.children}</div>
    );
  return { Stage: node("stage"), Layer: node("layer"), Image: node("image"), Rect: node("rect") };
});

const MIDDLE = 1;
const LEFT = 0;

function canvas() {
  render(<EditorCanvas src={null} />);
  return screen.getByTestId("editor-canvas");
}

describe("EditorCanvas middle-button panning", () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
    useEditorStore.setState({ image: exampleImage, view: { scale: 1, x: 0, y: 0 } });
  });

  it("pans the view by the pointer delta while the middle button is held", () => {
    const el = canvas();
    fireEvent.mouseDown(el, { button: MIDDLE, clientX: 100, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 130, clientY: 70 });
    expect(useEditorStore.getState().view).toMatchObject({ x: 30, y: 20, scale: 1 });
  });

  it("keeps tracking when the pointer leaves the canvas, and stops on release", () => {
    const el = canvas();
    fireEvent.mouseDown(el, { button: MIDDLE, clientX: 0, clientY: 0 });
    // Listening on window, not the div: a drag that wanders off the canvas keeps panning.
    fireEvent.mouseMove(window, { clientX: 40, clientY: 40 });
    expect(useEditorStore.getState().view).toMatchObject({ x: 40, y: 40 });
    fireEvent.mouseUp(window, { button: MIDDLE });
    fireEvent.mouseMove(window, { clientX: 999, clientY: 999 });
    expect(useEditorStore.getState().view).toMatchObject({ x: 40, y: 40 });
  });

  it("leaves the view alone for the left button, so drawing still works", () => {
    const el = canvas();
    fireEvent.mouseDown(el, { button: LEFT, clientX: 100, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });
    expect(useEditorStore.getState().view).toMatchObject({ x: 0, y: 0 });
  });

  it("prevents the default middle-click action", () => {
    // Chromium — and therefore WebView2 in the packaged app — starts autoscroll on a middle
    // press. fireEvent returns false when the event was cancelled.
    const el = canvas();
    expect(fireEvent.mouseDown(el, { button: MIDDLE, clientX: 10, clientY: 10 })).toBe(false);
  });

  it("pans from wherever the press landed, not from the previous view origin", () => {
    useEditorStore.setState({ view: { scale: 2, x: -500, y: -300 } });
    const el = canvas();
    fireEvent.mouseDown(el, { button: MIDDLE, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 110, clientY: 90 });
    // The delta is applied to the view as it was at mousedown, and the scale is untouched.
    expect(useEditorStore.getState().view).toMatchObject({ x: -490, y: -310, scale: 2 });
  });
});
