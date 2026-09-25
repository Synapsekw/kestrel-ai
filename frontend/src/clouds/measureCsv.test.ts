import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, measurementsCsv } from "./measureCsv";

describe("measurements CSV", () => {
  it("writes the export's columns and quotes text", () => {
    const csv = measurementsCsv([
      {
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
});
