import { describe, expect, it } from "vitest";
import type { MapRun } from "@contract/client";
import type { Survey } from "@/mapws/w4host";
import { exampleMapRun } from "@/test/fixtures";
import {
  DEFAULT_FILTERS,
  boxCentre,
  chunk,
  detectionSelection,
  lookOf,
  parseDetectionId,
  shownRuns,
  sideDates,
  surveyMaps,
} from "./detectModel";

const survey = (date: string, maps: { id: string; basis_run_id: string | null }[], planned = false) =>
  ({
    date,
    planned,
    date_is_import_date: false,
    note: null,
    surfaces: [],
    maps: maps.map((m) => ({ ...m, name: m.id, gsd_cm: 3 })),
  }) as unknown as Survey;
const surveys = [
  survey("2026-08-14", [{ id: "aug", basis_run_id: "ra" }]),
  survey("2026-09-14", [{ id: "sep", basis_run_id: null }]),
  survey("2026-10-14", [], true),
];
const run = (p: Partial<MapRun>): MapRun => ({
  ...exampleMapRun,
  state: "succeeded",
  scope: "map",
  pinned: false,
  ...p,
});

describe("which maps a pane shows", () => {
  it("single mode shows r; swipe/blend both; side-by-side splits", () => {
    const v = { l: "2026-08-14", r: "2026-09-14" };
    expect(sideDates({ ...v, mode: "single" }, "single")).toEqual(["2026-09-14"]);
    expect(sideDates({ ...v, mode: "swipe" }, "single")).toEqual(["2026-08-14", "2026-09-14"]);
    expect(sideDates({ ...v, mode: "side" }, "left")).toEqual(["2026-08-14"]);
    expect(sideDates({ ...v, mode: "side" }, "right")).toEqual(["2026-09-14"]);
  });
  it("takes the maps of those survey dates from the workspace surveys, or all flown ones", () => {
    expect(surveyMaps(surveys, ["2026-09-14"], false)).toEqual([
      { id: "sep", name: "sep", date: "2026-09-14", basisRunId: null },
    ]);
    expect(surveyMaps(surveys, [], true).map((m) => m.id)).toEqual(["sep", "aug"]);
  });
});

describe("runs shown per map (R-W4-6)", () => {
  it("is the survey basis run, else pinned, else newest whole-map run, plus region runs", () => {
    const old = run({ id: "old", created_at: "2026-09-01T00:00:00Z" });
    const pinned = run({
      id: "pin",
      created_at: "2026-08-01T00:00:00Z",
      pinned: true,
    });
    const newest = run({ id: "new", created_at: "2026-09-20T00:00:00Z" });
    const region = run({
      id: "reg",
      scope: "region",
      created_at: "2026-09-25T00:00:00Z",
    });
    const failed = run({ id: "bad", state: "failed" });
    expect(shownRuns([old, newest, region, failed], null).map((r) => r.id)).toEqual(["new", "reg"]);
    expect(shownRuns([old, pinned, newest], null).map((r) => r.id)).toEqual(["pin"]);
    expect(shownRuns([old, pinned, newest], "old").map((r) => r.id)).toEqual(["old"]);
    expect(shownRuns([region], null).map((r) => r.id)).toEqual(["reg"]);
  });
});

describe("selection ids", () => {
  it("round-trips run and detection", () => {
    expect(detectionSelection("r1", "d1")).toEqual({
      kind: "detection",
      id: "r1.d1",
    });
    expect(parseDetectionId("r1.d1")).toEqual({
      runId: "r1",
      detectionId: "d1",
    });
    expect(parseDetectionId("nodot")).toBeNull();
  });
});

describe("how a detection looks (spec §9.3)", () => {
  const f = DEFAULT_FILTERS;
  it("pending defects violet dashed; accepted defects hidden (they are findings)", () => {
    expect(lookOf({ review_state: "unreviewed", class_id: "t" }, "defect", f, false)).toBe("pending-defect");
    expect(lookOf({ review_state: "accepted", class_id: "t" }, "defect", f, false)).toBe("hidden");
    expect(
      lookOf({ review_state: "accepted", class_id: "t" }, "defect", { ...f, findings: true }, false),
    ).toBe("accepted-defect");
  });
  it("objects as class boxes; rejected hidden unless asked; hidden types always hidden", () => {
    expect(lookOf({ review_state: "unreviewed", class_id: "t" }, "object", f, false)).toBe("object");
    expect(lookOf({ review_state: "edited", class_id: "t" }, "object", f, false)).toBe("object-accepted");
    expect(lookOf({ review_state: "rejected", class_id: "t" }, "object", f, false)).toBe("hidden");
    expect(
      lookOf({ review_state: "rejected", class_id: "t" }, "object", { ...f, rejected: true }, false),
    ).toBe("rejected");
    expect(
      lookOf(
        { review_state: "unreviewed", class_id: "t" },
        "object",
        { ...f, hiddenTypes: new Set(["t"]) },
        true,
      ),
    ).toBe("hidden");
    expect(lookOf({ review_state: "unreviewed", class_id: "t" }, "object", f, true)).toBe("selected");
  });
  it("centres a box and chunks ids", () => {
    expect(
      boxCentre([
        [0, 0],
        [2, 0],
        [2, 4],
        [0, 4],
      ]),
    ).toEqual([1, 2]);
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });
});
