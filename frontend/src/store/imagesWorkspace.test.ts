import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDetail, makeMeasurement, makeShape } from "@/images/canvas/testing";
import {
  acceptedShapes,
  isDrawing,
  pendingSuggestions,
  saveState,
  selectedShapes,
  singleSelected,
  useImagesWorkspace,
  viewportImageRect,
  waitForIdle,
} from "./imagesWorkspace";

const st = () => useImagesWorkspace.getState();

const accepted = makeShape({ id: "a", review_state: "accepted", created_at: "2026-09-27T10:00:00Z" });
const s1 = makeShape({
  id: "s1",
  review_state: "unreviewed",
  confidence: 0.4,
  provenance: { kind: "local_model", model_id: "m", provider: null, model_name: "M", query_run_id: null },
  created_at: "2026-09-27T10:00:01Z",
});
const s2 = makeShape({ ...s1, id: "s2", confidence: 0.9, created_at: "2026-09-27T10:00:02Z" });
const rejected = makeShape({ ...s1, id: "r", review_state: "rejected", created_at: "2026-09-27T10:00:03Z" });

beforeEach(() => {
  st().reset();
  st().setViewport({ width: 1000, height: 800 });
  st().loadImage(makeDetail(), [accepted, s1, s2, rejected], [makeMeasurement()]);
});
afterEach(() => vi.useRealTimers());

describe("loading an image", () => {
  it("fits the view and starts a fresh history", () => {
    const before = st().history;
    st().loadImage(makeDetail({ id: "other" }), [], []);
    expect(st().fitted).toBe(true);
    expect(st().view.scale).toBeCloseTo(Math.min(968 / 4000, 768 / 3000));
    expect(st().history).not.toBe(before);
    expect(st().selectedIds).toEqual([]);
  });

  it("keeps the view with Keep zoom when the next image has the same size", () => {
    st().setView({ scale: 1.5, x: -300, y: -200 });
    st().setKeepZoom(true);
    st().loadImage(makeDetail({ id: "next" }), [], []);
    expect(st().view).toEqual({ scale: 1.5, x: -300, y: -200 });
    st().loadImage(makeDetail({ id: "small", width: 2000, height: 1500 }), [], []);
    expect(st().view.scale).not.toBe(1.5);
  });

  it("keeps finding links per image (FC-R16)", () => {
    st().linkFindings({ a: "f1" });
    expect(st().findingOf).toEqual({ a: "f1" });
    st().unlinkFinding("a");
    expect(st().findingOf).toEqual({});
    st().linkFindings({ a: "f1" });
    st().loadImage(makeDetail({ id: "other" }), [], []);
    expect(st().findingOf).toEqual({});
  });

  it("ignores a shape that belongs to another image", () => {
    st().upsertBox(makeShape({ id: "stray", image_id: "elsewhere" }));
    expect(st().boxes.stray).toBeUndefined();
  });
});

describe("selectors", () => {
  it("draws accepted shapes on layer 2 and nothing when annotations are hidden", () => {
    expect(acceptedShapes(st()).map((b) => b.id)).toEqual(["a"]);
    st().toggleAnnotations();
    expect(acceptedShapes(st())).toEqual([]);
  });

  it("lists pending suggestions above the threshold, most confident first", () => {
    expect(pendingSuggestions(st()).map((b) => b.id)).toEqual(["s2", "s1"]);
    st().setThreshold(0.5);
    expect(pendingSuggestions(st()).map((b) => b.id)).toEqual(["s2"]);
    st().toggleSuggestions();
    expect(pendingSuggestions(st())).toEqual([]);
  });

  it("clamps the threshold to [0, 1]", () => {
    st().setThreshold(1.3);
    expect(st().threshold).toBe(1);
    st().setThreshold(-1);
    expect(st().threshold).toBe(0);
  });

  it("selects, toggles and reports a single selection", () => {
    st().select(["a"]);
    expect(singleSelected(st())?.id).toBe("a");
    st().select(["s1"], "toggle");
    expect(selectedShapes(st()).map((b) => b.id)).toEqual(["a", "s1"]);
    expect(singleSelected(st())).toBeNull();
    st().select(["a"], "toggle");
    expect(st().selectedIds).toEqual(["s1"]);
    st().select(["missing"]);
    expect(st().selectedIds).toEqual([]);
  });

  it("selecting a shape clears a selected measurement and the other way round", () => {
    st().selectMeasurement(Object.keys(st().measurements)[0]);
    st().select(["a"]);
    expect(st().selectedMeasurementId).toBeNull();
    st().selectMeasurement(Object.keys(st().measurements)[0]);
    expect(st().selectedIds).toEqual([]);
  });

  it("reports the save state", () => {
    expect(saveState(st())).toBe("saved");
    st().beginRequest();
    expect(saveState(st())).toBe("saving");
    st().endRequest();
    st().fail("draw box failed: boom", () => undefined);
    expect(saveState(st())).toBe("failed");
    st().clearFailure();
    expect(saveState(st())).toBe("saved");
  });

  it("knows when a draft is open", () => {
    expect(isDrawing(st())).toBe(false);
    st().setDraft({ kind: "length", a: { x: 1, y: 1 }, b: null });
    expect(isDrawing(st())).toBe(true);
  });
});

describe("view", () => {
  it("gives the visible image rectangle, clipped to the image", () => {
    st().setView({ scale: 1, x: -100, y: -50 });
    expect(viewportImageRect(st())).toEqual({ x: 100, y: 50, w: 1000, h: 800 });
    st().setView({ scale: 0.1, x: 0, y: 0 });
    expect(viewportImageRect(st())).toEqual({ x: 0, y: 0, w: 4000, h: 3000 });
  });

  it("centres on a point and zooms so the radius circle fills a third of the canvas", () => {
    st().centreOn({ x: 2000, y: 1500 }, { radiusPx: 24 });
    const { view } = st();
    expect(view.scale).toBeCloseTo(800 / 3 / 48);
    expect(view.x + 2000 * view.scale).toBeCloseTo(500);
    expect(view.y + 1500 * view.scale).toBeCloseTo(400);
  });

  it("pans a rectangle into view only when it is not visible", () => {
    st().setView({ scale: 1, x: 0, y: 0 });
    st().panIntoView({ x: 10, y: 10, w: 50, h: 50 });
    expect(st().view).toEqual({ scale: 1, x: 0, y: 0 });
    st().panIntoView({ x: 3000, y: 2000, w: 100, h: 100 });
    expect(st().view.x + 3050).toBeCloseTo(500);
    expect(st().view.y + 2050).toBeCloseTo(400);
  });

  it("animates when asked and lands exactly on the target", () => {
    vi.useFakeTimers();
    st().setView({ scale: 1, x: 0, y: 0 });
    st().centreOn({ x: 3000, y: 2000 }, { animate: true });
    vi.advanceTimersByTime(400);
    expect(st().view.x).toBeCloseTo(500 - 3000);
  });
});

describe("waitForIdle", () => {
  it("resolves once every request has ended", async () => {
    st().beginRequest();
    let done = false;
    const p = waitForIdle().then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    st().endRequest();
    await p;
    expect(done).toBe(true);
  });
});
