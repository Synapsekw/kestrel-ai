/* eslint-disable react-refresh/only-export-components --
   a test-only stand-in for react-konva that also exports its spies; never hot-reloaded. */
import { forwardRef, useImperativeHandle, type ReactNode } from "react";

type P = Record<string, unknown> & { children?: ReactNode };

/** The props the last-rendered Stage received; tests call its handlers directly. */
export const stageProps: { current: P | null } = { current: null };
/** Leaf node renders by tag (memo tests). */
export const renders: Record<string, number> = {};
/** The props the last-rendered node of each tag received; tests call its handlers directly. */
export const lastProps: Record<string, P> = {};
/** What `stageRef.current` is in tests. */
export const fakeStage = {
  pointer: { x: 0, y: 0 },
  getPointerPosition() {
    return this.pointer;
  },
  getRelativePointerPosition() {
    return this.pointer;
  },
  findOne: () => undefined,
  batchDraw: () => undefined,
};

const str = (v: unknown) => (v === undefined ? undefined : typeof v === "string" ? v : JSON.stringify(v));

function attrs(tag: string, p: P) {
  return {
    "data-konva": tag,
    "data-name": str(p.name),
    "data-id": str(p.id),
    "data-x": str(p.x),
    "data-y": str(p.y),
    "data-rotation": str(p.rotation),
    "data-points": str(p.points),
    "data-radius": str(p.radius),
    "data-text": str(p.text),
    "data-stroke": str(p.stroke),
    "data-dash": str(p.dash),
    "data-closed": str(p.closed),
    "data-listening": str(p.listening ?? true),
    "data-visible": str(p.visible ?? true),
    "data-draggable": str(p.draggable ?? false),
    "data-shadow": str(p.shadowBlur),
  };
}

function node(tag: string) {
  return forwardRef<unknown, P>(function MockNode(p, ref) {
    useImperativeHandle(
      ref,
      () => ({
        nodes: () => undefined,
        getLayer: () => null,
        getStage: () => fakeStage,
        to: () => undefined,
        opacity: () => undefined,
      }),
      [],
    );
    renders[tag] = (renders[tag] ?? 0) + 1;
    lastProps[tag] = p;
    return <div {...attrs(tag, p)}>{p.children as ReactNode}</div>;
  });
}

export const Stage = forwardRef<unknown, P>(function MockStage(p, ref) {
  useImperativeHandle(ref, () => fakeStage, []);
  stageProps.current = p;
  return <div {...attrs("stage", p)}>{p.children as ReactNode}</div>;
});
export const Layer = node("layer");
export const Group = node("group");
export const Rect = node("rect");
export const Line = node("line");
export const Circle = node("circle");
export const Text = node("text");
export const Image = node("image");
export const Transformer = node("transformer");
