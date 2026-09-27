import { act, fireEvent, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { keysFor } from "@/ui/keymap";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { makeDetail, makeShape } from "@/images/canvas/testing";
import {
  FA_ACTIONS,
  findRowCollisions,
  IMAGES_KEY_ROWS,
  registerKeyRows,
  row,
  useHeldKeys,
  useImagesKeymap,
  whenMatches,
  whenOverlaps,
} from "./keymap";

const st = () => useImagesWorkspace.getState();
const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...init });

beforeEach(() => {
  st().reset();
  st().loadImage(makeDetail(), [makeShape({ id: "b" })], []);
});

describe("the images key table (spec §13)", () => {
  it("has no two rows on one chord with overlapping `when`", () => {
    expect(findRowCollisions(IMAGES_KEY_ROWS)).toEqual([]);
  });

  it("stays collision-free with FA's rows added", () => {
    const fa = [
      row("severity", "idle"),
      row("ai-detect", "idle"),
      row("smart-polygon", "always"),
      row("accept", "idle"),
      row("reject", "idle"),
      row("accept-all", "idle"),
      row("reject-all", "idle"),
      row("next-pending", "idle"),
      row("previous-pending", "idle"),
      row("threshold-down", "always"),
      row("threshold-up", "always"),
    ];
    expect(fa.map((r) => r.action).sort()).toEqual([...FA_ACTIONS].sort());
    expect(findRowCollisions([...IMAGES_KEY_ROWS, ...fa])).toEqual([]);
  });

  it("covers every images, global and review action except FA's and the app's own", () => {
    const appLevel = new Set(["palette", "shortcuts", "pan-hold"]);
    const wanted = new Set(
      keysFor("images")
        .map((e) => e.action)
        .filter((a) => !appLevel.has(a) && !FA_ACTIONS.includes(a)),
    );
    expect(new Set(IMAGES_KEY_ROWS.map((r) => r.action))).toEqual(wanted);
  });

  it("takes keys and help from F's table, merging an action's entries", () => {
    expect(row("fit", "always").keys.sort()).toEqual(["0", "F"]);
    expect(() => row("teleport", "always")).toThrow(/not an images, global or review key/);
  });

  it("refuses a row that collides", () => {
    expect(() => registerKeyRows([row("commit", "always")])).toThrow(/Enter/);
  });

  it("knows which `when` overlaps which", () => {
    expect(whenOverlaps("drawing", "idle")).toBe(false);
    expect(whenOverlaps("drawing", "selection")).toBe(false);
    expect(whenOverlaps("idle", "selection")).toBe(true);
    expect(whenOverlaps("always", "drawing")).toBe(true);
  });

  it("matches `when` against the store", () => {
    expect(whenMatches("idle", st())).toBe(true);
    expect(whenMatches("selection", st())).toBe(false);
    st().select(["b"]);
    expect(whenMatches("selection", st())).toBe(true);
    st().setDraft({ kind: "length", a: { x: 0, y: 0 }, b: null });
    expect(whenMatches("selection", st())).toBe(false);
    expect(whenMatches("drawing", st())).toBe(true);
  });

  it("matches only `cancel` while a dialog or the picker is open (m4)", () => {
    st().setConfirm({ kind: "delete", ids: ["b"], findings: [] });
    expect(whenMatches("always", st(), "box")).toBe(false);
    expect(whenMatches("always", st(), "cancel")).toBe(true);
    st().setConfirm(null);
    st().openPicker({ x: 0, y: 0 }, "active");
    expect(whenMatches("always", st(), "undo")).toBe(false);
    expect(whenMatches("always", st(), "cancel")).toBe(true);
    st().closePicker();
    expect(whenMatches("always", st(), "box")).toBe(true);
  });
});

describe("useImagesKeymap", () => {
  it("dispatches by action and falls through a layer that declines", () => {
    const first = vi.fn(() => false);
    const second = vi.fn();
    renderHook(() => useImagesKeymap([{ box: first }, { box: second }]));
    key("b");
    expect(first).toHaveBeenCalledWith("B");
    expect(second).toHaveBeenCalledWith("B");
  });

  it("gates by `when`: Enter commits only while drawing", () => {
    const commit = vi.fn();
    renderHook(() => useImagesKeymap([{ commit }]));
    key("Enter");
    expect(commit).not.toHaveBeenCalled();
    act(() => st().setDraft({ kind: "length", a: { x: 0, y: 0 }, b: null }));
    key("Enter");
    expect(commit).toHaveBeenCalledOnce();
  });

  it("ignores keys typed into a field", () => {
    const box = vi.fn();
    renderHook(() => useImagesKeymap([{ box }]));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "b" });
    expect(box).not.toHaveBeenCalled();
    input.remove();
  });

  it("acts on the image loaded in the same tick", () => {
    const seen: (string | null)[] = [];
    renderHook(() =>
      useImagesKeymap([{ delete: () => void seen.push(useImagesWorkspace.getState().imageId) }]),
    );
    act(() => {
      st().loadImage(makeDetail({ id: "next" }), [makeShape({ id: "n", image_id: "next" })], []);
      st().select(["n"]);
    });
    key("Delete");
    expect(seen).toEqual(["next"]);
  });

  it("passes the chord so one action can read its direction", () => {
    const nudge = vi.fn();
    st().select(["b"]);
    renderHook(() => useImagesKeymap([{ nudge }]));
    key("ArrowLeft", { altKey: true, shiftKey: true });
    expect(nudge).toHaveBeenCalledWith("Alt+Shift+ArrowLeft");
  });
});

describe("useHeldKeys", () => {
  it("tracks Space, Shift and Alt and forgets them on blur", () => {
    renderHook(() => useHeldKeys());
    key(" ");
    key("Shift", { shiftKey: true });
    expect(st().spaceHeld).toBe(true);
    expect(st().shiftHeld).toBe(true);
    fireEvent.keyUp(window, { key: " " });
    expect(st().spaceHeld).toBe(false);
    fireEvent.blur(window);
    expect(st().shiftHeld).toBe(false);
  });

  it("leaves Space to a focused button, and takes it on the body or inside the canvas (m3)", () => {
    renderHook(() => useHeldKeys());
    const button = document.createElement("button");
    const host = document.createElement("div");
    host.dataset.testid = "image-canvas";
    const inside = document.createElement("span");
    host.append(inside);
    document.body.append(button, host);
    expect(fireEvent.keyDown(button, { key: " " })).toBe(true); // not prevented
    expect(st().spaceHeld).toBe(false);
    expect(fireEvent.keyDown(inside, { key: " " })).toBe(false);
    expect(st().spaceHeld).toBe(true);
    fireEvent.keyUp(window, { key: " " });
    expect(fireEvent.keyDown(document.body, { key: " " })).toBe(false);
    expect(st().spaceHeld).toBe(true);
    button.remove();
    host.remove();
  });
});
