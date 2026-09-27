import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { exampleClasses, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { ensureBuiltInTools } from "@/images/tools";
import { useImagesKeymap } from "@/images/workspace/keymap";
import { useCanvasKeyHandlers } from "./useCanvasKeys";
import { gatedClient, makeDetail, makeShape } from "./testing";
import type { CommandContext } from "./commands";

const st = () => useImagesWorkspace.getState();
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => void fireEvent.keyDown(window, { key: k, ...init }));

function setup() {
  const { api, requests } = fakeClient([
    { method: "PATCH", path: /\/boxes\/b$/, body: (req) => ({ ...st().boxes.b, ...(req.body as object) }) },
  ]);
  const ctx: CommandContext = {
    api,
    projectId: PROJECT_ID,
    store: useImagesWorkspace,
    history: st().history,
  };
  renderHook(() => useImagesKeymap([useCanvasKeyHandlers(ctx)]));
  return { requests };
}

beforeEach(() => {
  ensureBuiltInTools();
  st().reset();
  useImagesWorkspace.setState({ projectId: PROJECT_ID, types: [exampleClasses[0]], tool: "select" });
  st().loadImage(makeDetail(), [makeShape({ id: "b", x: 100, y: 100, w: 50, h: 40 })], []);
});

describe("canvas keys", () => {
  it("B, R, P, M, L, V and H choose tools", () => {
    setup();
    for (const [k, tool] of [
      ["b", "box"],
      ["r", "rbox"],
      ["p", "polygon"],
      ["m", "point"],
      ["l", "length"],
      ["h", "pan"],
      ["v", "select"],
    ] as const) {
      key(k);
      expect(st().tool).toBe(tool);
    }
  });

  it("Esc cancels the draft first, then deselects", () => {
    setup();
    st().select(["b"]);
    st().setTool("length");
    st().setDraft({ kind: "length", a: { x: 0, y: 0 }, b: null });
    key("Escape");
    expect(st().draft).toBeNull();
    expect(st().selectedIds).toEqual(["b"]);
    key("Escape");
    expect(st().selectedIds).toEqual([]);
  });

  it("Ctrl+Z while drawing a polygon removes the last vertex instead of undoing", () => {
    setup();
    st().setTool("polygon");
    st().setDraft({
      kind: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
      cursor: null,
      pressed: false,
      lastScreen: null,
    });
    key("z", { ctrlKey: true });
    const d = st().draft;
    expect(d?.kind === "polygon" ? d.points : []).toHaveLength(1);
  });

  it("Alt+Shift+→ nudges 10 px, Alt+→ 1 px", async () => {
    const { requests } = setup();
    st().select(["b"]);
    key("ArrowRight", { altKey: true, shiftKey: true });
    await waitFor(() => expect(st().boxes.b.x).toBe(110));
    expect(requests.at(-1)?.body).toMatchObject({ x: 110 });
    key("ArrowRight", { altKey: true });
    await waitFor(() => expect(st().boxes.b.x).toBe(111));
  });

  it("Ctrl+Z pressed while a nudge is saving undoes it once the save lands (I1)", async () => {
    const { api, requests, gate } = gatedClient([
      { method: "PATCH", path: /\/boxes\/b$/, body: (req) => ({ ...st().boxes.b, ...(req.body as object) }) },
    ]);
    const ctx: CommandContext = {
      api,
      projectId: PROJECT_ID,
      store: useImagesWorkspace,
      history: st().history,
    };
    renderHook(() => useImagesKeymap([useCanvasKeyHandlers(ctx)]));
    st().select(["b"]);
    key("ArrowRight", { altKey: true });
    await waitFor(() => expect(gate.arrived).toBe(1));
    key("z", { ctrlKey: true });
    expect(st().pending).toBeGreaterThan(0);
    gate.release();
    await waitFor(() => expect(gate.arrived).toBe(2));
    gate.release();
    await waitFor(() => expect(st().pending).toBe(0));
    expect(requests.map((r) => (r.body as { x: number }).x)).toEqual([101, 100]);
    expect(st().boxes.b.x).toBe(100);
  });

  it("keys do nothing behind an open dialog or picker; Esc closes it (m4)", () => {
    setup();
    st().setConfirm({ kind: "delete", ids: ["b"], findings: [] });
    key("b");
    expect(st().tool).toBe("select");
    key("Escape");
    expect(st().confirm).toBeNull();
    st().openPicker({ x: 0, y: 0 }, "active");
    key("r");
    expect(st().tool).toBe("select");
    key("Escape");
    expect(st().picker).toBeNull();
    key("r");
    expect(st().tool).toBe("rbox");
  });

  it("T opens the picker to retype a selection, or to choose the active type", () => {
    setup();
    key("t");
    expect(st().picker?.purpose).toBe("active");
    st().closePicker();
    st().select(["b"]);
    key("t");
    expect(st().picker?.purpose).toBe("retype");
  });

  it("Shift+H and G toggle the layers", () => {
    setup();
    key("H", { shiftKey: true });
    expect(st().showAnnotations).toBe(false);
    key("g");
    expect(st().showSuggestions).toBe(false);
  });

  it("+, − and 0 zoom and fit", () => {
    setup();
    st().setViewport({ width: 1000, height: 800 });
    const fitted = st().view.scale;
    key("+");
    expect(st().view.scale).toBeGreaterThan(fitted);
    key("0");
    expect(st().view.scale).toBeCloseTo(fitted);
  });
});
