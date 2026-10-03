import { describe, expect, it, vi } from "vitest";
import { StatusCell, statusText, type LayerStatus } from "./status";

describe("StatusCell", () => {
  it("starts loading, tells subscribers, and stops telling them after unsubscribe", () => {
    const cell = new StatusCell();
    expect(cell.get()).toEqual({ kind: "loading" });
    const cb = vi.fn();
    const off = cell.subscribe(cb);
    cell.set({ kind: "ready" });
    expect(cb).toHaveBeenCalledWith({ kind: "ready" });
    off();
    cell.set({ kind: "error", message: "x" });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cell.get()).toEqual({ kind: "error", message: "x" });
  });
});

describe("statusText", () => {
  const cases: [LayerStatus, boolean, string][] = [
    [{ kind: "loading" }, true, "loading"],
    [{ kind: "ready" }, true, "shown"],
    [{ kind: "ready" }, false, "hidden"],
    [{ kind: "ready", note: "Flat water (reduced effects)" }, true, "shown, Flat water (reduced effects)"],
    [
      { kind: "unavailable", reason: "No posed photos in this project." },
      true,
      "No posed photos in this project.",
    ],
    [
      { kind: "error", message: "The cloud could not load: HTTP 404" },
      false,
      "The cloud could not load: HTTP 404",
    ],
  ];
  it.each(cases)("%o (visible %s) reads %s", (s, visible, text) => {
    expect(statusText(s, visible)).toBe(text);
  });
});
