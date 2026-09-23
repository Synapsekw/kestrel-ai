import { describe, expect, it } from "vitest";
import { LABEL_SCREEN_PX, MIN_SCREEN_PX, markFor } from "./detectionMark";

describe("markFor", () => {
  // The reported map: 86904 px wide, fit to a ~1200 px pane, so ~72 map px per screen px.
  const FULL_EXTENT = 72;

  it("clamps a correctly-scaled 9 m machine at full extent", () => {
    // 8.9 m at 2.296 cm/px is 331 map px, which is 4.6 screen px - below the floor.
    expect(markFor(331, 331, FULL_EXTENT)).toBe("clamped");
  });

  it("clamps the 60 px boxes the wrong-scale run produced", () => {
    expect(markFor(60, 75, FULL_EXTENT)).toBe("clamped");
  });

  it("draws a true box once it is over the floor", () => {
    expect(markFor(MIN_SCREEN_PX + 1, MIN_SCREEN_PX + 1, 1)).toBe("box");
  });

  it("labels a box once it is big enough to read", () => {
    expect(markFor(LABEL_SCREEN_PX + 1, LABEL_SCREEN_PX + 1, 1)).toBe("labelled");
  });

  it("switches exactly on the boundaries", () => {
    expect(markFor(MIN_SCREEN_PX - 0.01, 1, 1)).toBe("clamped");
    expect(markFor(MIN_SCREEN_PX, 1, 1)).toBe("box");
    expect(markFor(LABEL_SCREEN_PX - 0.01, 1, 1)).toBe("box");
    expect(markFor(LABEL_SCREEN_PX, 1, 1)).toBe("labelled");
  });

  it("uses the longer side, so a thin box is not clamped needlessly", () => {
    expect(markFor(100, 2, 1)).toBe("labelled");
  });

  it("treats a zero or negative resolution as fully zoomed in", () => {
    expect(markFor(10, 10, 0)).toBe("labelled");
  });
});
