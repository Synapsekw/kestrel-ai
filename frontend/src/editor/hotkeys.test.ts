import { describe, it, expect } from "vitest";
import { actionForKey, isTypingTarget, type KeyLike } from "./hotkeys";

function key(k: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { type: "keydown", key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

describe("actionForKey", () => {
  it("maps class keys and reserved editor keys", () => {
    expect(actionForKey(key("1"))).toEqual({ type: "class-key", key: "1" });
    expect(actionForKey(key("9"))).toEqual({ type: "class-key", key: "9" });
    expect(actionForKey(key("x"))).toEqual({ type: "class-key", key: "x" });
    expect(actionForKey(key("0"))).toEqual({ type: "one-to-one" });
    expect(actionForKey(key("1", { ctrlKey: true }))).toEqual({ type: "one-to-one" });
    expect(actionForKey(key("f"))).toEqual({ type: "fit" });
    expect(actionForKey(key("F"))).toEqual({ type: "fit" });
    expect(actionForKey(key("a"))).toEqual({ type: "accept-all" });
    expect(actionForKey(key("r"))).toEqual({ type: "reject-all" });
    expect(actionForKey(key("n"))).toEqual({ type: "toggle-empty" });
    expect(actionForKey(key("N"))).toEqual({ type: "toggle-empty" });
    expect(actionForKey(key("Delete"))).toEqual({ type: "delete" });
    expect(actionForKey(key("Backspace"))).toEqual({ type: "delete" });
    expect(actionForKey(key("Escape"))).toEqual({ type: "escape" });
  });

  it("maps control chords, treating meta as control", () => {
    expect(actionForKey(key("d", { ctrlKey: true }))).toEqual({ type: "duplicate" });
    expect(actionForKey(key("z", { ctrlKey: true }))).toEqual({ type: "undo" });
    expect(actionForKey(key("y", { ctrlKey: true }))).toEqual({ type: "redo" });
    expect(actionForKey(key("Z", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "redo" });
    expect(actionForKey(key("ArrowRight", { metaKey: true }))).toEqual({ type: "next" });
    expect(actionForKey(key("ArrowLeft", { ctrlKey: true }))).toEqual({ type: "prev" });
    expect(actionForKey(key("x", { ctrlKey: true }))).toBeNull();
    expect(actionForKey(key("x", { altKey: true }))).toBeNull();
  });

  it("tracks the space bar without auto-repeat", () => {
    expect(actionForKey(key(" "))).toEqual({ type: "space-down" });
    expect(actionForKey(key(" ", { repeat: true }))).toBeNull();
    expect(actionForKey({ ...key(" "), type: "keyup" })).toEqual({ type: "space-up" });
    expect(actionForKey({ ...key("f"), type: "keyup" })).toBeNull();
  });

  it("ignores shifted letters and non-printable keys", () => {
    expect(actionForKey(key("X", { shiftKey: true }))).toBeNull();
    expect(actionForKey(key("ArrowUp"))).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("is true for inputs, textareas and selects", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("undo and redo ignore key repeat", () => {
  it("returns null for a held Ctrl+Z or Ctrl+Y", () => {
    expect(actionForKey(key("z", { ctrlKey: true, repeat: true }))).toBeNull();
    expect(actionForKey(key("y", { ctrlKey: true, repeat: true }))).toBeNull();
    expect(actionForKey(key("Z", { ctrlKey: true, shiftKey: true, repeat: true }))).toBeNull();
    expect(actionForKey(key("d", { ctrlKey: true, repeat: true }))).toEqual({ type: "duplicate" });
  });
});

describe("next and previous ignore key repeat", () => {
  it("returns null for a held Ctrl+Right or Ctrl+Left", () => {
    expect(actionForKey(key("ArrowRight", { ctrlKey: true, repeat: true }))).toBeNull();
    expect(actionForKey(key("ArrowLeft", { metaKey: true, repeat: true }))).toBeNull();
    expect(actionForKey(key("ArrowRight", { ctrlKey: true }))).toEqual({ type: "next" });
  });
});

describe("N ignores key repeat (I5)", () => {
  it("returns null for a held N and the action for a single press", () => {
    expect(actionForKey(key("n", { repeat: true }))).toBeNull();
    expect(actionForKey(key("N", { repeat: true }))).toBeNull();
    expect(actionForKey(key("n"))).toEqual({ type: "toggle-empty" });
  });
});
