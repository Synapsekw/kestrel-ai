import { describe, expect, it } from "vitest";
import { reviewedCount, statusHints } from "./statusHints";

describe("statusHints", () => {
  it("shows the active tool's own line from FC", () => {
    expect(statusHints("Click add point · Enter close · Backspace remove point · Esc cancel", 4)).toEqual([
      { keys: [], help: "Click add point · Enter close · Backspace remove point · Esc cancel" },
    ]);
  });
  it("falls back to the workspace defaults with the scale's digits", () => {
    const hints = statusHints("", 4);
    expect(hints.map((h) => h.help)).toEqual([
      "select",
      "box",
      "polygon",
      "smart",
      "measure",
      "pan",
      "image",
      "severity",
    ]);
    expect(hints.at(-1)!.keys).toEqual(["1–4"]);
    expect(hints[6].keys).toEqual(["←", "→"]);
  });
});

it("counts reviewed flags (bit 1)", () => {
  expect(reviewedCount([1, 0, 3, 8, 9])).toBe(3);
});
