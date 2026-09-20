import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { BoxLayer } from "./BoxLayer";
import { useEditorStore } from "@/store/editor";
import { exampleClasses, exampleImage, personBox } from "@/test/fixtures";

vi.mock("react-konva", () => {
  const node = (tag: string) => (props: Record<string, unknown>) => (
    <div
      data-konva={tag}
      data-name={String(props.name ?? "")}
      data-x={String(props.x ?? "")}
      data-y={String(props.y ?? "")}
      data-rotation={String(props.rotation ?? "")}
      data-offset-x={String(props.offsetX ?? "")}
      data-offset-y={String(props.offsetY ?? "")}
      data-rotate-enabled={String(props.rotateEnabled ?? "")}
      data-rotation-snaps={JSON.stringify(props.rotationSnaps ?? null)}
    >
      {props.children as React.ReactNode}
    </div>
  );
  return { Layer: node("layer"), Rect: node("rect"), Text: node("text"), Transformer: node("transformer") };
});

function seed(angle: number, shiftHeld = false) {
  const box = { ...personBox, angle };
  useEditorStore.setState({
    image: exampleImage,
    boxes: { [box.id]: box },
    order: [box.id],
    selectedId: box.id,
    shiftHeld,
    // Pinned rather than left to whatever a previous test left behind: the label's screen offset
    // is `14 / scale`, so a test that asserts an exact label position must fix the scale too.
    view: { scale: 1, x: 0, y: 0 },
  });
  return box;
}

describe("BoxLayer rotation", () => {
  it("pivots a box about its centre", () => {
    const box = seed(45);
    render(<BoxLayer classes={exampleClasses} onCommitRect={vi.fn()} />);
    const node = document.querySelector(`[data-name="box ${box.id}"]`)!;
    expect(node.getAttribute("data-rotation")).toBe("45");
    expect(node.getAttribute("data-offset-x")).toBe(String(box.w / 2));
    expect(node.getAttribute("data-offset-y")).toBe(String(box.h / 2));
    expect(node.getAttribute("data-x")).toBe(String(box.x + box.w / 2));
    expect(node.getAttribute("data-y")).toBe(String(box.y + box.h / 2));
  });

  it("enables the rotate handle", () => {
    seed(0);
    render(<BoxLayer classes={exampleClasses} onCommitRect={vi.fn()} />);
    const tr = document.querySelector('[data-konva="transformer"]')!;
    expect(tr.getAttribute("data-rotate-enabled")).toBe("true");
  });

  it("offers snaps only while Shift is held", () => {
    seed(0, false);
    const { unmount } = render(<BoxLayer classes={exampleClasses} onCommitRect={vi.fn()} />);
    expect(
      JSON.parse(document.querySelector('[data-konva="transformer"]')!.getAttribute("data-rotation-snaps")!),
    ).toEqual([]);
    unmount();
    seed(0, true);
    render(<BoxLayer classes={exampleClasses} onCommitRect={vi.fn()} />);
    expect(
      JSON.parse(document.querySelector('[data-konva="transformer"]')!.getAttribute("data-rotation-snaps")!),
    ).toEqual([
      0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300, 315,
      330, 345,
    ]);
  });

  it("anchors the label to the top-most corner of a rotated box", () => {
    // personBox is 140x90 at (512, 300), centre (582, 345). At 90 degrees its corners are
    // (627,275), (627,415), (537,415), (537,275) — so the top-most is (627, 275) and the label
    // hangs 14 screen px above it. The pre-rotation anchor would be (512, 286), which is why
    // `data-x` is asserted: a y-only check passes against the un-anchored implementation too.
    seed(90);
    render(<BoxLayer classes={exampleClasses} onCommitRect={vi.fn()} />);
    const label = document.querySelector('[data-konva="text"]')!;
    expect(Number(label.getAttribute("data-x"))).toBeCloseTo(627, 6);
    expect(Number(label.getAttribute("data-y"))).toBeCloseTo(275 - 14, 6);
  });

  it("leaves an unrotated box's label where it has always been", () => {
    const box = seed(0);
    render(<BoxLayer classes={exampleClasses} onCommitRect={vi.fn()} />);
    const label = document.querySelector('[data-konva="text"]')!;
    expect(Number(label.getAttribute("data-x"))).toBe(box.x);
  });
});
