import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, geometryWkt, measurementsCsv } from "./measureCsv";
import type { CloudMeasurement } from "@/api/cloudMeasurements";

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
    expect(row).toBe(
      "m2,Point 1,point,gate post,1,2,3,0.01,,,,,48.1,28.2,,,,,,,,,,,,0.01,,1,POINT Z (1.0 2.0 3.0)" +
        ",".repeat(17),
    );
    expect(row.split(",")).toHaveLength(CSV_COLUMNS.length);
  });
});

const S1_NULLS = {
  lon: null,
  lat: null,
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
  uncertainty_m: null,
  angle_uncertainty_deg: null,
};

function saved(o: Partial<CloudMeasurement> & Pick<CloudMeasurement, "kind" | "points">): CloudMeasurement {
  return {
    ...WORKSPACE,
    id: "m9",
    point_cloud_id: "c",
    name: "M",
    note: null,
    results: { ...S1_NULLS, ...NEW_RESULTS },
    created_at: "2026-09-27T10:00:00Z",
    updated_at: "2026-09-27T10:00:00Z",
    ...o,
  };
}

/** A CSV line split into its cells (quotes honoured), so a quoted WKT stays one cell. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const byColumn = (csv: string) => {
  const c = cells(csv.trim().split("\r\n")[1]);
  expect(c).toHaveLength(CSV_COLUMNS.length);
  return Object.fromEntries(CSV_COLUMNS.map((k, i) => [k, c[i]])) as Record<string, string>;
};

const P = (x: number, y: number, z: number, group?: 0 | 1) => ({
  x,
  y,
  z,
  uncertainty_m: 0.01,
  ...(group === undefined ? {} : { group }),
});

describe("measurements CSV, workspace kinds (the export's columns, C-B1 Ruling 10)", () => {
  it("has the export's 46 columns in its order", () => {
    expect(CSV_COLUMNS.join(",")).toBe(
      "id,name,kind,note,x1,y1,z1,u1,x2,y2,z2,u2,lon,lat,dx,dy,dz,distance_3d,distance_horizontal,distance_vertical,height_difference,lean_offset_m,lean_angle_deg,lean_azimuth_deg,lean_mm_per_m,uncertainty_m,angle_uncertainty_deg,vertex_count,geometry_wkt,area_m2,area_surface_m2,area_plan_m2,perimeter_m,plane_rms_m,plane_tilt_deg,plane_azimuth_deg,uncertainty_m2,ring_radius_lower_m,ring_radius_upper_m,ring_rms_lower_m,ring_rms_upper_m,profile_length_m,profile_z_min,profile_z_max,profile_width_max_m,profile_point_count",
    );
  });

  it("writes an area as a closed POLYGON Z and leaves x1..u2 blank", () => {
    const c = byColumn(
      measurementsCsv([
        saved({
          kind: "area",
          points: [P(500000, 4983000, 100), P(500001, 4983000, 100), P(500001, 4983001, 100)],
          results: { ...S1_NULLS, ...NEW_RESULTS, area_m2: 0.5, area_surface_m2: 0.5, area_plan_m2: 0.5 },
        }),
      ]),
    );
    expect(c.x1).toBe("");
    expect(c.u2).toBe("");
    expect(c.vertex_count).toBe("3");
    expect(c.geometry_wkt).toBe(
      "POLYGON Z ((500000.0 4983000.0 100.0, 500001.0 4983000.0 100.0, 500001.0 4983001.0 100.0, 500000.0 4983000.0 100.0))",
    );
    expect(c.area_m2).toBe("0.5");
  });

  it("writes a rings check as the axis between the fitted centres", () => {
    const ring = (cx: number, z: number, g: 0 | 1) =>
      [0, 120, 240].map((d) =>
        P(cx + Math.cos((d * Math.PI) / 180), 20 + Math.sin((d * Math.PI) / 180), z, g),
      );
    const c = byColumn(
      measurementsCsv([
        saved({
          kind: "vertical",
          params: { method: "rings" },
          points: [...ring(10, 0, 0), ...ring(10.1, 10, 1)],
        }),
      ]),
    );
    expect(c.vertex_count).toBe("6");
    expect(c.geometry_wkt.startsWith("LINESTRING Z (")).toBe(true);
    const nums = (c.geometry_wkt.match(/-?\d+(\.\d+)?(e[+-]?\d+)?/g) ?? []).map(Number);
    [10, 20, 0, 10.1, 20, 10].forEach((want, i) => expect(Math.abs(nums[i] - want)).toBeLessThan(1e-9));
  });

  it("writes a section as its line and fills x1..u2", () => {
    const c = byColumn(
      measurementsCsv([
        saved({ kind: "profile", params: { thickness_m: 0.2 }, points: [P(1.5, 2, 3), P(4, 2, 3)] }),
      ]),
    );
    expect(c.geometry_wkt).toBe("LINESTRING Z (1.5 2.0 3.0, 4.0 2.0 3.0)");
    expect([c.x1, c.x2]).toEqual(["1.5", "4"]);
  });

  it("leaves the geometry empty when stored rings no longer fit", () => {
    expect(
      geometryWkt(
        "vertical",
        [P(0, 0, 0, 0), P(1, 0, 0, 0), P(2, 0, 0, 0), P(0, 0, 9, 1), P(1, 0, 9, 1), P(2, 0, 9, 1)],
        { method: "rings" },
      ),
    ).toBe("");
  });
});
