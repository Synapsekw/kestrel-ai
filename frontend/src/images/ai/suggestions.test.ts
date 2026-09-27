import { describe, expect, it } from "vitest";
import type { Box } from "@contract/client";
import { personBox, proposalBox } from "@/test/fixtures";
import {
  boundsOf,
  hiddenCount,
  nextFlaggedImage,
  outlineOf,
  stepWalk,
  targetOf,
  visibleSuggestions,
  walkOrder,
} from "./suggestions";

const box = (id: string, conf: number | null, o: Partial<Box> = {}): Box =>
  ({
    ...proposalBox,
    shape: "box",
    points: null,
    assist: null,
    area_px: 1,
    updated_at: proposalBox.created_at,
    id,
    confidence: conf,
    ...o,
  }) as Box;

const s1 = box("s1", 0.3);
const s2 = box("s2", 0.8);
const s3 = box("s3", 0.8);
const acc = box("a1", 0.9, { review_state: "accepted" });
const person = { ...personBox, id: "p1" } as Box;
const boxes = { s1, s2, s3, a1: acc, p1: person };
const order = ["s1", "s2", "s3", "a1", "p1"];
const none = new Set<string>();

describe("visibleSuggestions", () => {
  it("keeps unreviewed at or above the threshold, highest first, ties by id", () => {
    expect(
      visibleSuggestions(boxes, order, { threshold: 0.5, show: true, inFlight: none }).map((b) => b.id),
    ).toEqual(["s2", "s3"]);
  });
  it("shows everything pending at threshold 0 and nothing when hidden (G)", () => {
    expect(visibleSuggestions(boxes, order, { threshold: 0, show: true, inFlight: none })).toHaveLength(3);
    expect(visibleSuggestions(boxes, order, { threshold: 0, show: false, inFlight: none })).toHaveLength(0);
  });
  it("drops ids whose review request is in flight (two fast A presses)", () => {
    expect(
      visibleSuggestions(boxes, order, { threshold: 0, show: true, inFlight: new Set(["s2"]) }).map(
        (b) => b.id,
      ),
    ).toEqual(["s3", "s1"]);
  });
  it("counts what the threshold hides", () => {
    expect(hiddenCount(boxes, order, 0.5)).toBe(1);
    expect(hiddenCount(boxes, order, 0)).toBe(0);
  });
});

describe("targets and the Tab walk", () => {
  const visible = visibleSuggestions(boxes, order, { threshold: 0.5, show: true, inFlight: none });
  it("targets the selected pending suggestion, else the top one", () => {
    expect(targetOf(visible, "s3")?.id).toBe("s3");
    expect(targetOf(visible, "a1")?.id).toBe("s2");
    expect(targetOf(visible, "s1")?.id).toBe("s2"); // below the threshold: not a target
    expect(targetOf([], null)).toBeNull();
  });
  it("walks suggestions, then findings, then crosses", () => {
    const seq = walkOrder(visible, order, (id) => id === "a1");
    expect(seq).toEqual(["s2", "s3", "a1"]);
    expect(stepWalk(seq, null, 1)).toEqual({ kind: "box", id: "s2" });
    expect(stepWalk(seq, "s3", 1)).toEqual({ kind: "box", id: "a1" });
    expect(stepWalk(seq, "a1", 1)).toEqual({ kind: "cross" });
    expect(stepWalk(seq, "s2", -1)).toEqual({ kind: "cross" });
    expect(stepWalk(seq, null, -1)).toEqual({ kind: "box", id: "a1" });
    expect(stepWalk([], null, 1)).toEqual({ kind: "cross" });
  });
  it("finds the next and previous image with pending suggestions, no wrap", () => {
    const index = { ids: ["i1", "i2", "i3", "i4"], flags: [2, 1, 3, 0] };
    expect(nextFlaggedImage(index, "i1", 1)).toBe("i3");
    expect(nextFlaggedImage(index, "i3", 1)).toBeNull();
    expect(nextFlaggedImage(index, "i3", -1)).toBe("i1");
    expect(nextFlaggedImage(index, "zz", 1)).toBe("i1");
  });
});

describe("outlines", () => {
  it("draws a box, a rotated box and a polygon in image px", () => {
    expect(outlineOf(box("b", 1, { x: 10, y: 20, w: 30, h: 40 }))).toEqual([10, 20, 40, 20, 40, 60, 10, 60]);
    const r = outlineOf(box("r", 1, { shape: "rbox", x: 0, y: 0, w: 20, h: 10, angle: 90 }));
    expect(r.map((v) => Math.round(v))).toEqual([15, -5, 15, 15, 5, 15, 5, -5]);
    expect(
      outlineOf(
        box("p", 1, {
          shape: "polygon",
          points: [
            [1, 2],
            [5, 2],
            [3, 6],
          ],
        }),
      ),
    ).toEqual([1, 2, 5, 2, 3, 6]);
    expect(boundsOf([1, 2, 5, 2, 3, 6])).toEqual({ x: 1, y: 2, w: 4, h: 4 });
  });
});
