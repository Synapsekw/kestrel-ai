import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, measurementsCsv } from "./measureCsv";

/** The fields C-C0 added to every saved measurement (contract 2026-09-27); the CSV ignores them. */
const WORKSPACE = {
  params: null,
  status: "ready" as const,
  error: null,
  job_id: null,
  finding_id: null,
  view: null,
};
const NEW_RESULTS = {
  area_m2: null,
  area_surface_m2: null,
  area_plan_m2: null,
  perimeter_m: null,
  plane_rms_m: null,
  plane_tilt_deg: null,
  plane_azimuth_deg: null,
  uncertainty_m2: null,
  ring_radius_lower_m: null,
  ring_radius_upper_m: null,
  ring_rms_lower_m: null,
  ring_rms_upper_m: null,
  profile_length_m: null,
  profile_z_min: null,
  profile_z_max: null,
  profile_width_max_m: null,
  profile_point_count: null,
};

describe("measurements CSV", () => {
  it("writes the export's columns and quotes text", () => {
    const csv = measurementsCsv([
      {
        ...WORKSPACE,
        id: "m1",
        point_cloud_id: "c",
        kind: "distance",
        name: 'Gate, "north"',
        note: null,
        points: [
          { x: 1, y: 2, z: 3, uncertainty_m: 0.01 },
          { x: 4, y: 6, z: 3, uncertainty_m: 0.02 },
        ],
        results: {
          ...NEW_RESULTS,
          lon: null,
          lat: null,
          dx: 3,
          dy: 4,
          dz: 0,
          distance_3d: 5,
          distance_horizontal: 5,
          distance_vertical: 0,
          height_difference: 0,
          lean_offset_m: null,
          lean_angle_deg: null,
          lean_azimuth_deg: null,
          lean_mm_per_m: null,
          uncertainty_m: 0.0224,
          angle_uncertainty_deg: null,
        },
        created_at: "2026-09-24T10:00:00Z",
        updated_at: "2026-09-24T10:00:00Z",
      },
    ]);
    const [head, row] = csv.trim().split("\r\n");
    expect(head.split(",")).toEqual([...CSV_COLUMNS]);
    expect(
      row.startsWith('m1,"Gate, ""north""",distance,,1,2,3,0.01,4,6,3,0.02,,,3,4,0,5,5,0,0,,,,,0.0224,'),
    ).toBe(true);
  });
  it("pads a single-point measurement's second point with empty cells", () => {
    const csv = measurementsCsv([
      {
        ...WORKSPACE,
        id: "m2",
        point_cloud_id: "c",
        kind: "point",
        name: "Point 1",
        note: "gate post",
        points: [{ x: 1, y: 2, z: 3, uncertainty_m: 0.01 }],
        results: {
          ...NEW_RESULTS,
          lon: 48.1,
          lat: 28.2,
          dx: null,
          dy: null,
          dz: null,
          distance_3d: null,
          distance_horizontal: null,
          distance_vertical: null,
          height_difference: null,
          lean_offset_m: null,
          lean_angle_deg: null,
          lean_azimuth_deg: null,
          lean_mm_per_m: null,
          uncertainty_m: 0.01,
          angle_uncertainty_deg: null,
        },
        created_at: "2026-09-24T10:00:00Z",
        updated_at: "2026-09-24T10:00:00Z",
      },
    ]);
    const row = csv.trim().split("\r\n")[1];
    expect(row).toBe("m2,Point 1,point,gate post,1,2,3,0.01,,,,,48.1,28.2,,,,,,,,,,,,0.01,");
    expect(row.split(",")).toHaveLength(CSV_COLUMNS.length);
  });
});
