import { Profiler } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import type { CloudClipBox } from "@contract/client";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { readPins } from "@/clouds/viewer/diagnostics";
import type { FrameCamera, Vec3 } from "@/clouds/viewer/types";
import { projectTypes, TYPE_SPALLING } from "@/test/findingFixtures";
import { PinsLayer } from "./PinsLayer";
import { at, frameCamera } from "./testCamera";
import type { CloudPin } from "./types";

const types = new Map(projectTypes.map((t) => [t.id, t]));
const pin = (id: string, p: Vec3, extra: Partial<CloudPin> = {}): CloudPin => ({
  id,
  number: 1,
  typeId: TYPE_SPALLING,
  severity: 3,
  status: "open",
  note: "",
  p,
  u: 0.05,
  normal: null,
  ...extra,
});

function fakeViewer() {
  const frames = new Set<(c: FrameCamera) => void>();
  const settles = new Set<() => void>();
  const occlusion = vi.fn<CloudViewerHandle["occlusion"]>((points) => points.map(() => true));
  const requestRender = vi.fn();
  const handle = {
    onFrame: (cb: (c: FrameCamera) => void) => {
      frames.add(cb);
      return () => frames.delete(cb);
    },
    onSettle: (cb: () => void) => {
      settles.add(cb);
      return () => settles.delete(cb);
    },
    occlusion,
    requestRender,
  } as unknown as CloudViewerHandle;
  return {
    ref: { current: handle } as { current: CloudViewerHandle | null },
    occlusion,
    requestRender,
    emit: (cam: FrameCamera) => act(() => frames.forEach((f) => f(cam))),
    settle: () => act(() => settles.forEach((s) => s())),
    listeners: () => ({ frames: frames.size, settles: settles.size }),
  };
}

const south = frameCamera(at(0, -100, 30));
const pinEl = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="cloud-pin"][data-id="${id}"]`)!;

type Props = Parameters<typeof PinsLayer>[0];

function mount(v: ReturnType<typeof fakeViewer>, pins: CloudPin[], extra: Partial<Props> = {}) {
  const onSelect = vi.fn();
  const onRender = vi.fn();
  let props: Props = {
    viewer: v.ref,
    pins,
    types,
    draft: null,
    selectedId: null,
    clipBox: null,
    calloutEl: null,
    onSelect,
    ...extra,
  };
  const tree = () => (
    <Profiler id="pins" onRender={onRender}>
      <PinsLayer {...props} />
    </Profiler>
  );
  const utils = render(tree());
  /** Re-renders the same tree with changed props (a different tree would remount the layer). */
  const update = (changes: Partial<Props>) => {
    props = { ...props, ...changes };
    utils.rerender(tree());
  };
  return { ...utils, onSelect, onRender, update };
}

describe("PinsLayer", () => {
  it("follows frames by DOM writes, without a React render per frame", () => {
    const v = fakeViewer();
    const { onRender } = mount(v, [pin("a", at(0, 0, 0))]);
    // the mount's own request and the arriving pins' (m7), in one commit: the engine schedules one
    // frame for both (a requestRender while a frame is pending is a no-op)
    expect(v.requestRender).toHaveBeenCalledTimes(2);
    const renders = onRender.mock.calls.length;
    for (let i = 0; i < 30; i++) v.emit(frameCamera(at(i, -100, 30)));
    expect(onRender.mock.calls.length).toBe(renders);
    expect(pinEl("a").dataset.state).toBe("visible");
  });

  it("runs the occlusion pass on settle with max(0.3, 3u) and dims the hidden pins", () => {
    const v = fakeViewer();
    mount(v, [pin("a", at(0, 0, 0), { u: 0.2 })]);
    v.emit(south);
    v.occlusion.mockClear();
    v.settle();
    expect(v.occlusion).toHaveBeenCalledTimes(1);
    expect(v.occlusion.mock.calls[0][1]).toEqual([expect.closeTo(0.6, 9)]);
    expect(pinEl("a").dataset.state).toBe("back");
    v.emit(frameCamera(at(5, -100, 30)));
    expect(pinEl("a").dataset.state).toBe("visible");
  });

  it("runs occlusion at once for pins that arrive while settled", () => {
    const v = fakeViewer();
    const { update } = mount(v, [pin("a", at(0, 0, 0))]);
    v.emit(south);
    v.occlusion.mockClear();
    update({ pins: [pin("a", at(0, 0, 0)), pin("b", at(1, 0, 0))] });
    expect(v.occlusion).toHaveBeenCalledTimes(1);
    expect(pinEl("b").dataset.state).toBe("back");
  });

  // C-G final review m7: findings that answer after settle were set but never projected, since no
  // frame came until the camera moved; the layer now asks for one (never from the settle listener).
  it("asks for a frame when pins arrive or move while settled, and not when nothing changed", () => {
    const v = fakeViewer();
    const { update } = mount(v, []);
    v.emit(south);
    v.requestRender.mockClear();
    update({ pins: [pin("late", at(0, 0, 0))] });
    expect(v.requestRender).toHaveBeenCalledTimes(1);
    v.requestRender.mockClear();
    update({ pins: [pin("late", at(0, 0, 0))] });
    expect(v.requestRender).not.toHaveBeenCalled();
    v.settle();
    expect(v.requestRender).not.toHaveBeenCalled();
  });

  it("runs occlusion again for a pin moved while settled, at its new position", () => {
    const v = fakeViewer();
    const { update } = mount(v, [pin("a", at(0, 0, 0))]);
    v.emit(south);
    v.occlusion.mockClear();
    update({ pins: [pin("a", at(5, 0, 0))] });
    expect(v.occlusion).toHaveBeenCalledTimes(1);
    expect(v.occlusion.mock.calls[0][0]).toEqual([at(5, 0, 0)]);
  });

  it("keeps the flags when occlusion answers null (the loop is running)", () => {
    const v = fakeViewer();
    v.occlusion.mockImplementation(() => null);
    mount(v, [pin("a", at(0, 0, 0))]);
    v.emit(south);
    v.settle();
    expect(pinEl("a").dataset.state).toBe("visible");
  });

  it("hides pins outside a show-inside clip box and dims them in highlight mode", () => {
    const v = fakeViewer();
    const { update } = mount(v, [pin("in", at(0, 0, 0)), pin("out", at(30, 0, 0))]);
    v.emit(south);
    const box = { centre: at(0, 0, 0), size: [10, 10, 10], yaw_deg: 0 };
    update({ clipBox: { ...box, mode: "show_inside" } as CloudClipBox });
    expect(pinEl("in").dataset.state).toBe("visible");
    expect(pinEl("out").dataset.state).toBe("hidden");
    update({ clipBox: { ...box, mode: "highlight_inside" } as CloudClipBox });
    expect(pinEl("out").dataset.state).toBe("back");
  });

  it("selects on a pin click and places the callout host for the selected pin", () => {
    const v = fakeViewer();
    const card = document.createElement("div");
    document.body.append(card);
    const { onSelect, update } = mount(v, [pin("a", at(0, 0, 0))], { calloutEl: card });
    v.emit(south);
    pinEl("a").querySelector<HTMLButtonElement>("button")!.click();
    expect(onSelect).toHaveBeenCalledWith("a");
    update({ selectedId: "a" });
    expect(card.dataset.state).toBe("shown");
    update({ selectedId: null });
    expect(card.dataset.state).toBe("hidden");
  });

  it("draws the draft pin dashed and never sends it to occlusion", () => {
    const v = fakeViewer();
    mount(v, [], { draft: { p: at(0, 0, 0), u: 0.05, normal: null } });
    v.emit(south);
    expect(pinEl("draft").hasAttribute("data-draft")).toBe(true);
    v.occlusion.mockClear();
    v.settle();
    expect(v.occlusion).not.toHaveBeenCalled();
  });

  it("registers the diagnostics probe while mounted", () => {
    const v = fakeViewer();
    const { unmount } = mount(v, [pin("a", at(0, 0, 0))]);
    v.emit(south);
    expect(readPins().map((p) => [p.id, p.state])).toEqual([["a", "visible"]]);
    unmount();
    expect(readPins()).toEqual([]);
  });

  it("removes its frame and settle listeners and the pins probe on unmount", () => {
    const v = fakeViewer();
    const { unmount } = mount(v, [pin("a", at(0, 0, 0))]);
    expect(v.listeners()).toEqual({ frames: 1, settles: 1 });
    unmount();
    expect(v.listeners()).toEqual({ frames: 0, settles: 0 });
    expect(readPins()).toEqual([]);
  });
});
