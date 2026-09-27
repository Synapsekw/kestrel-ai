import { describe, expect, it } from "vitest";
import { survey } from "../test/fixtures";
import { createWorkspaceStore, parsePersisted, snapshot } from "./workspaceStore";

const TWO = [survey("2026-08-14"), survey("2026-09-14"), survey("2026-10-14", { planned: true })];
const THREE = [survey("2026-07-01"), ...TWO];

function store(surveys = TWO) {
  const s = createWorkspaceStore();
  s.getState().setSurveys(surveys);
  return s;
}

describe("workspace store", () => {
  it("defaults r to the newest flown survey and l to the one before", () => {
    const s = store();
    expect([s.getState().l, s.getState().r, s.getState().mode]).toEqual([
      "2026-08-14",
      "2026-09-14",
      "single",
    ]);
  });

  it("cycles Single → Swipe → Side-by-side → Blend → Single", () => {
    const s = store();
    const seen = [];
    for (let i = 0; i < 4; i++) {
      s.getState().cycleMode();
      seen.push(s.getState().mode);
    }
    expect(seen).toEqual(["swipe", "side", "blend", "single"]);
  });

  it("stays in Single with one survey (spec §14)", () => {
    const s = store([survey("2026-08-14"), survey("2026-10-14", { planned: true })]);
    s.getState().cycleMode();
    s.getState().setMode("swipe");
    expect(s.getState().mode).toBe("single");
  });

  it("collapses the layers panel in Side-by-side and restores it on leaving (spec §5, §15)", () => {
    const s = store();
    expect(s.getState().layersCollapsed).toBe(false);
    s.getState().setMode("side");
    expect(s.getState().layersCollapsed).toBe(true);
    s.getState().setMode("blend");
    expect(s.getState().layersCollapsed).toBe(false);

    s.getState().toggleLayersCollapsed(); // the operator collapsed it before
    s.getState().setMode("side");
    s.getState().toggleLayersCollapsed(); // and opened it inside Side-by-side
    s.getState().setMode("single");
    expect(s.getState().layersCollapsed).toBe(true);
  });

  it("keeps L < R: refuses a date pair out of order, and planned or unknown dates", () => {
    const s = store(THREE);
    s.getState().setMode("swipe");
    s.getState().setDates("2026-09-14", "2026-08-14");
    expect([s.getState().l, s.getState().r]).toEqual(["2026-08-14", "2026-09-14"]);
    s.getState().setDates("2026-08-14", "2026-10-14");
    expect(s.getState().r).toBe("2026-09-14");
    s.getState().setDates("2026-07-01", "2026-08-14");
    expect([s.getState().l, s.getState().r]).toEqual(["2026-07-01", "2026-08-14"]);
  });

  it("steps r with [ and ], never onto or below l in compare modes", () => {
    const s = store(THREE);
    s.getState().setMode("swipe"); // l 2026-08-14, r 2026-09-14
    expect(s.getState().stepRight(-1)).toBe(false);
    expect(s.getState().r).toBe("2026-09-14");
    expect(s.getState().stepRight(1)).toBe(false); // the planned date is skipped, nothing after it
    s.getState().setMode("single");
    expect(s.getState().stepRight(-1)).toBe(true);
    expect(s.getState().r).toBe("2026-08-14");
  });

  it("moves r forward when entering a compare mode with r on the oldest date", () => {
    const s = store(THREE);
    s.getState().setDates(null, "2026-07-01");
    s.getState().setMode("blend");
    expect([s.getState().l, s.getState().r]).toEqual(["2026-07-01", "2026-08-14"]);
  });

  it("plays from the start when P is pressed on the newest survey (R-W1-14)", () => {
    const s = store(THREE);
    s.getState().togglePlay();
    expect(s.getState().playing).toBe(true);
    expect(s.getState().r).toBe("2026-07-01");
    s.getState().togglePlay();
    expect(s.getState().playing).toBe(false);
  });

  it("clamps blend to 0–100 and the swipe divider to 2–98 %", () => {
    const s = store();
    s.getState().setBlend(140);
    s.getState().setSwipe(0);
    expect([s.getState().blend, s.getState().swipe]).toEqual([100, 2]);
  });

  it("round-trips its persisted state and rejects junk", () => {
    const s = store();
    s.getState().setMode("blend");
    s.getState().setBlend(30);
    s.getState().setLayerState("map:m1", { visible: false });
    s.getState().setOrder("base", ["map:m2", "map:m1"]);
    s.getState().setViewInfo({ center: [1, 2], resolution: 0.5, rotation: 0 });
    const snap = snapshot(s.getState());
    expect(snap).toMatchObject({
      v: 1,
      mode: "blend",
      blend: 30,
      order: { base: ["map:m2", "map:m1"] },
    });
    expect(snap.layers["map:m1"]).toEqual({ visible: false, opacity: 100 });

    const t = store();
    t.getState().hydrate(parsePersisted(JSON.parse(JSON.stringify(snap))));
    expect(snapshot(t.getState())).toEqual(snap);
    expect(t.getState().initialView).toEqual({
      center: [1, 2],
      resolution: 0.5,
      rotation: 0,
    });

    expect(parsePersisted(null)).toEqual({});
    expect(parsePersisted({ v: 1, mode: "sideways", blend: "x", layers: 3 })).toEqual({});
  });

  it("drops a persisted date that is no longer a survey", () => {
    const s = store();
    s.getState().hydrate({ r: "2020-01-01", mode: "single" });
    expect(s.getState().r).toBe("2026-09-14");
  });
});
