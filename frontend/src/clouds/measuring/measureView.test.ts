import { describe, expect, it } from "vitest";
import type { CloudMeasurement } from "@/api/cloudMeasurements";
import { CLOUD_ID } from "@/test/cloudFixtures";
import type { MPoint } from "../measure";
import { INITIAL_TOOL, cloudToolReducer, type CloudToolAction, type CloudToolState } from "../useCloudTool";
import {
  DEGREES,
  createBody,
  headline,
  labelAnchor,
  liveResult,
  measureKindOf,
  resultRows,
  rowText,
  stateOf,
  toolShapes,
} from "./measureView";

const p = (x: number, y: number, z = 0, u = 0.02): MPoint => ({ x, y, z, uncertainty_m: u });
const run = (actions: CloudToolAction[]): CloudToolState => actions.reduce(cloudToolReducer, INITIAL_TOOL);
const picks = (pts: MPoint[]): CloudToolAction[] => pts.map((point) => ({ type: "pick", point }));
const E = 553100;
const N = 4983000;
const square = [p(E, N, 100), p(E + 1, N, 100), p(E + 1, N + 1, 100), p(E, N + 1, 100)];
const ring = (cx: number, cy: number, z: number) =>
  [0, 120, 240].map((d) =>
    p(cx + Math.cos((d * Math.PI) / 180), cy + Math.sin((d * Math.PI) / 180), z, 0.01),
  );
const rings = run([
  { type: "arm", kind: "vertical" },
  { type: "method", method: "rings" },
  ...picks(ring(E, N, 0)),
  { type: "next-ring" },
  ...picks(ring(E, N, 10)),
]);

describe("liveResult", () => {
  it("gives nothing until the tool is complete", () => {
    expect(
      liveResult(run([{ type: "arm", kind: "distance" }, ...picks([p(0, 0)])]), false).results,
    ).toBeNull();
  });

  it("computes a distance and refuses it on a cloud in degrees", () => {
    const d = run([{ type: "arm", kind: "distance" }, ...picks([p(0, 0), p(3, 4)])]);
    expect(liveResult(d, false).results?.distance_3d).toBe(5);
    expect(liveResult(d, true)).toEqual({ results: null, refusal: DEGREES, warning: null });
  });

  it("previews S1's vertical span refusal", () => {
    const v = run([{ type: "arm", kind: "vertical" }, ...picks([p(0, 0, 0), p(0, 0, 0.3)])]);
    expect(liveResult(v, false).refusal).toBe("pick points further apart vertically (at least 0.5 m)");
  });

  it("measures a closed outline in the chosen mode, at UTM magnitudes", () => {
    const a = run([
      { type: "arm", kind: "area" },
      { type: "mode", mode: "plan" },
      ...picks(square),
      { type: "close" },
    ]);
    const r = liveResult(a, false);
    expect(r.results?.area_m2).toBeCloseTo(1, 9);
    expect(r.results?.area_plan_m2).toBeCloseTo(1, 9);
    expect(r.refusal).toBeNull();
  });

  it("says why a bow-tie cannot be measured, as the server will", () => {
    const bow = [p(0, 0), p(1, 1), p(1, 0), p(0, 1)];
    const r = liveResult(run([{ type: "arm", kind: "area" }, ...picks(bow), { type: "close" }]), false);
    expect(r.results).toBeNull();
    expect(r.refusal).toBeTruthy();
  });

  it("measures two rings on a plumb axis as no lean", () => {
    const r = liveResult(rings, false);
    expect(r.refusal).toBeNull();
    expect(r.results?.lean_angle_deg).toBeCloseTo(0, 6);
    expect(r.results?.ring_radius_lower_m).toBeCloseTo(1, 6);
  });

  it("refuses a section line under 0.1 m with the server's own text", () => {
    const s = run([{ type: "arm", kind: "profile" }, ...picks([p(0, 0, 5), p(0.05, 0, 9)])]);
    expect(liveResult(s, false).refusal).toBe(
      "a cross-section line must be 0.1 to 2 000 m long; this one is 0.05 m",
    );
  });

  it("refuses a section line over 2 000 m with the server's own text", () => {
    const s = run([{ type: "arm", kind: "profile" }, ...picks([p(0, 0, 5), p(2001, 0, 9)])]);
    expect(liveResult(s, false).refusal).toBe(
      "a cross-section line must be 0.1 to 2 000 m long; this one is 2001.00 m",
    );
  });

  it("refuses a closed area on a cloud in degrees", () => {
    const a = run([{ type: "arm", kind: "area" }, ...picks(square), { type: "close" }]);
    expect(liveResult(a, true)).toEqual({ results: null, refusal: DEGREES, warning: null });
  });

  it("refuses a complete rings check on a cloud in degrees", () => {
    expect(liveResult(rings, true)).toEqual({ results: null, refusal: DEGREES, warning: null });
  });

  it("refuses a complete section on a cloud in degrees", () => {
    const s = run([{ type: "arm", kind: "profile" }, ...picks([p(0, 0, 5), p(9, 0, 9)])]);
    expect(liveResult(s, true)).toEqual({ results: null, refusal: DEGREES, warning: null });
  });

  it("still gives results for a point on a cloud in degrees", () => {
    const pt = run([{ type: "arm", kind: "point" }, ...picks([p(1, 2, 3)])]);
    expect(liveResult(pt, true).results).not.toBeNull();
    expect(liveResult(pt, true).refusal).toBeNull();
  });
});

describe("createBody", () => {
  it("sends an outline with its mode and the camera direction", () => {
    const a = run([{ type: "arm", kind: "area" }, ...picks(square), { type: "close" }]);
    expect(createBody(a, [0, 0.6, -0.8])).toEqual({
      kind: "area",
      points: square,
      params: { mode: "surface", view_dir: [0, 0.6, -0.8] },
    });
  });

  it("sends rings with their groups and the method", () => {
    const b = createBody(rings, null);
    expect(b.params).toEqual({ method: "rings" });
    expect(b.points.map((q) => q.group)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it("sends a section with its thickness, and a distance with no params", () => {
    const s = run([
      { type: "arm", kind: "profile" },
      { type: "thickness", thicknessM: 0.5 },
      ...picks([p(0, 0, 5), p(9, 0, 9)]),
    ]);
    expect(createBody(s, null)).toEqual({
      kind: "profile",
      points: [p(0, 0, 5), p(9, 0, 5)],
      params: { thickness_m: 0.5 },
    });
    const d = run([{ type: "arm", kind: "distance" }, ...picks([p(0, 0), p(1, 0)])]);
    expect(createBody(d, null)).toEqual({ kind: "distance", points: [p(0, 0), p(1, 0)] });
  });
});

describe("toolShapes", () => {
  it("draws an open outline to the cursor, and a closed one with its fill", () => {
    const open = run([
      { type: "arm", kind: "area" },
      ...picks(square.slice(0, 3)),
      { type: "hover", point: square[3] },
    ]);
    expect(toolShapes(open).map((s) => s.kind)).toEqual(["points", "line"]);
    expect(toolShapes(open)[0].points).toHaveLength(4);
    const closed = run([{ type: "arm", kind: "area" }, ...picks(square), { type: "close" }]);
    expect(toolShapes(closed).map((s) => s.kind)).toEqual(["points", "line", "polygon"]);
  });

  it("draws each fitted ring, the centres and the axis", () => {
    expect(toolShapes(rings).map((s) => `${s.kind}:${s.tone}`)).toEqual([
      "points:accent",
      "line:accent",
      "points:ok",
      "line:ok",
      "points:warn",
      "line:warn",
    ]);
  });

  it("draws the section line to the cursor at A's height", () => {
    const s = run([
      { type: "arm", kind: "profile" },
      ...picks([p(0, 0, 5)]),
      { type: "hover", point: p(4, 0, 30) },
    ]);
    expect(toolShapes(s)[1].points[1]).toEqual({ x: 4, y: 0, z: 5 });
  });
});

const saved = (o: Partial<CloudMeasurement>): CloudMeasurement =>
  ({
    id: "m1",
    point_cloud_id: CLOUD_ID,
    kind: "area",
    name: "Area 1",
    note: null,
    points: square,
    results: { area_m2: 1.234, area_surface_m2: 1.234, area_plan_m2: 0.9 },
    params: { mode: "surface" },
    status: "ready",
    error: null,
    job_id: null,
    finding_id: null,
    view: null,
    created_at: "2026-09-27T10:00:00Z",
    updated_at: "2026-09-27T10:00:00Z",
    ...o,
  }) as CloudMeasurement;

describe("text", () => {
  it("heads an area with its primary value and the other area", () => {
    expect(headline("area", { mode: "surface" }, { area_m2: 1.234, area_plan_m2: 0.9 }, square)).toEqual({
      primary: "1.23 m²",
      secondary: "plan 0.90 m²",
    });
  });

  it("says a profile is computing, or why it failed", () => {
    const line = [p(0, 0, 5), p(12, 0, 5)];
    expect(
      rowText(
        saved({
          kind: "profile",
          points: line,
          status: "computing",
          results: {} as CloudMeasurement["results"],
        }),
      ),
    ).toEqual({ primary: "12.000 m", subtitle: "Cutting the profile…" });
    expect(
      rowText(
        saved({
          kind: "profile",
          points: line,
          status: "failed",
          error: "the source file is not reachable: D:/x.las",
        }),
      ).subtitle,
    ).toBe("the source file is not reachable: D:/x.las");
  });

  it("lists every area result with its uncertainty", () => {
    expect(resultRows(saved({})).map(([k]) => k)).toEqual([
      "Surface area",
      "Plan area",
      "Perimeter",
      "Tilt",
      "Facing",
      "Plane fit",
      "Uncertainty",
    ]);
  });

  it("anchors the label at the outline's centroid and a segment's middle", () => {
    const a = run([{ type: "arm", kind: "area" }, ...picks(square), { type: "close" }]);
    expect(labelAnchor(a)).toMatchObject({ x: E + 0.5, y: N + 0.5, z: 100 });
    const d = run([{ type: "arm", kind: "distance" }, ...picks([p(0, 0, 0), p(2, 0, 4)])]);
    expect(labelAnchor(d)).toMatchObject({ x: 1, y: 0, z: 2 });
  });
});

describe("stateOf and measureKindOf", () => {
  it("rebuilds a saved rings check with its groups", () => {
    const s = stateOf(
      saved({ kind: "vertical", params: { method: "rings" }, points: createBody(rings, null).points }),
    );
    expect(s.method).toBe("rings");
    expect(s.picks.map((q) => q.group)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it("maps C-W1's palette tools to the kinds they save", () => {
    expect(measureKindOf("distance")).toBe("distance");
    expect(measureKindOf("vertical")).toBe("vertical");
    expect(measureKindOf("section")).toBe("profile");
    expect(measureKindOf("orbit")).toBeNull();
    expect(measureKindOf("clip")).toBeNull();
    expect(measureKindOf(null)).toBeNull();
  });
});
