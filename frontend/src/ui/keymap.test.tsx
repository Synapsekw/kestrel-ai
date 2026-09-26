import { fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GLOBAL_KEYS,
  KEYMAP,
  REVIEW_KEYS,
  WORKSPACE_KEYS,
  chordOf,
  findCollisions,
  formatChord,
  isTypingTarget,
  keysFor,
  normaliseChord,
  useToolShortcuts,
  type KeyEntry,
  type KeyLike,
} from "./keymap";

const ev = (key: string, mods: Partial<Omit<KeyLike, "key">> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

afterEach(() => vi.restoreAllMocks());

describe("isTypingTarget", () => {
  it("is true for inputs, textareas, selects and editable content", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("chords", () => {
  it.each<[KeyLike, string]>([
    [ev("k", { ctrlKey: true }), "Ctrl+K"],
    [ev("K", { metaKey: true, shiftKey: true }), "Ctrl+Shift+K"],
    [ev("a"), "A"],
    [ev("A"), "A"],
    [ev("A", { shiftKey: true }), "Shift+A"],
    [ev("?", { shiftKey: true }), "?"],
    [ev("+", { shiftKey: true }), "+"],
    [ev(" "), "Space"],
    [ev("Esc"), "Escape"],
    [ev("Del"), "Delete"],
    [ev("Tab", { shiftKey: true }), "Shift+Tab"],
    [ev("ArrowLeft", { altKey: true }), "Alt+ArrowLeft"],
    [ev("1", { altKey: true }), "Alt+1"],
    [ev("[", { ctrlKey: true }), "Ctrl+["],
  ])("%j is %s", (e, chord) => {
    expect(chordOf(e)).toBe(chord);
  });

  it("normalises hand-written chords and formats them for key caps", () => {
    expect(normaliseChord("ctrl+k")).toBe("Ctrl+K");
    expect(normaliseChord("shift+a")).toBe("Shift+A");
    expect(normaliseChord("Esc")).toBe("Escape");
    expect(normaliseChord("+")).toBe("+");
    expect(formatChord("Ctrl+K")).toEqual(["Ctrl", "K"]);
    expect(formatChord("Shift+ArrowLeft")).toEqual(["Shift", "←"]);
    expect(formatChord("Escape")).toEqual(["Esc"]);
    expect(formatChord("+")).toEqual(["+"]);
  });
});

describe("the app keymap (spec §5.6)", () => {
  it("writes every chord in canonical form", () => {
    for (const entry of KEYMAP) {
      for (const key of entry.keys) expect(normaliseChord(key), `${entry.scope}/${entry.action}`).toBe(key);
    }
  });

  it("has no collisions", () => {
    expect(findCollisions(KEYMAP)).toEqual([]);
  });

  it("catches a workspace key that equals a global or review key", () => {
    const bad: KeyEntry[] = [
      ...GLOBAL_KEYS,
      ...REVIEW_KEYS,
      { keys: ["F"], scope: "maps", action: "x", help: "" },
      { keys: ["3"], scope: "clouds", action: "y", help: "" },
    ];
    expect(
      findCollisions(bad)
        .map((c) => c.chord)
        .sort(),
    ).toEqual(["3", "F"]);
  });

  it("catches two entries sharing a key in one scope", () => {
    const bad: KeyEntry[] = [
      { keys: ["B"], scope: "images", action: "box", help: "" },
      { keys: ["B"], scope: "images", action: "brush", help: "" },
      { keys: ["B"], scope: "maps", action: "fine-elsewhere", help: "" },
    ];
    expect(findCollisions(bad)).toHaveLength(1);
  });

  it("lets fly mode reuse review keys but not global ones", () => {
    const fly = (key: string): KeyEntry => ({ keys: [key], scope: "clouds.fly", action: "move", help: "" });
    expect(findCollisions([...GLOBAL_KEYS, ...REVIEW_KEYS, fly("A")])).toEqual([]);
    expect(findCollisions([...GLOBAL_KEYS, ...REVIEW_KEYS, fly("F")])).toHaveLength(1);
  });

  it("gives M, L, D, Q and E one meaning in every workspace that has them", () => {
    const meaning = (scope: "images" | "maps" | "clouds", chord: string) =>
      WORKSPACE_KEYS[scope].find((e) => e.keys.includes(chord))?.action;
    for (const scope of ["images", "maps", "clouds"] as const) {
      expect(meaning(scope, "M")).toBe("finding-marker");
      expect(meaning(scope, "L")).toBe("measure-length");
    }
    expect(meaning("images", "D")).toBe("ai-detect");
    expect(meaning("maps", "D")).toBe("ai-detect");
    for (const scope of ["maps", "clouds"] as const) {
      expect(meaning(scope, "Q")).toBe("area");
      expect(meaning(scope, "E")).toBe("profile");
    }
  });

  it("lists a screen's keys for the ? sheet", () => {
    const keys = keysFor("maps").flatMap((e) => e.keys);
    expect(keys).toContain("Ctrl+K");
    expect(keys).toContain("A");
    expect(keys).toContain("Shift+N");
    expect(keys).not.toContain("W");
  });

  it("reserves an empty findings scope for S1's J/K, Shift+O/R/C entries", () => {
    expect(WORKSPACE_KEYS.findings).toEqual([]);
    expect(keysFor("findings")).toEqual([...GLOBAL_KEYS, ...REVIEW_KEYS]);
  });
});

describe("useToolShortcuts", () => {
  it("fires a tool's key, ignores typing and key repeat, and releases on unmount", () => {
    const onTrigger = vi.fn();
    const { unmount } = renderHook(() => useToolShortcuts([{ shortcut: "B", onTrigger }]));
    fireEvent.keyDown(window, { key: "b" });
    expect(onTrigger).toHaveBeenCalledTimes(1);
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "b" });
    input.remove();
    fireEvent.keyDown(window, { key: "b", repeat: true });
    expect(onTrigger).toHaveBeenCalledTimes(1);
    unmount();
    fireEvent.keyDown(window, { key: "b" });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("skips disabled tools and honours enabled=false", () => {
    const onTrigger = vi.fn();
    const { rerender } = renderHook(({ on }) => useToolShortcuts([{ shortcut: "B", onTrigger }], on), {
      initialProps: { on: false },
    });
    fireEvent.keyDown(window, { key: "b" });
    expect(onTrigger).not.toHaveBeenCalled();
    rerender({ on: true });
    fireEvent.keyDown(window, { key: "b" });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("refuses a global or review key unless the tool is that key's action", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const area = vi.fn();
    const select = vi.fn();
    renderHook(() =>
      useToolShortcuts([
        { shortcut: "A", action: "area", onTrigger: area },
        { shortcut: "V", action: "tool-select", onTrigger: select },
      ]),
    );
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "v" });
    expect(area).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"A"'));
  });
});
