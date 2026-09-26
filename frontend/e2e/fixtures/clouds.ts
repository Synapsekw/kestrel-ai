import type { Page } from "@playwright/test";

export const CLOUD = "c0000000-8888-4000-8000-000000000001";
const CORS = { "Access-Control-Allow-Origin": "*" };

/** A `PointCloudOut` for the red/green fixture grid at the chimney's UTM position. */
export function cloudJson(overrides: Record<string, unknown> = {}) {
  return {
    id: CLOUD,
    name: "Fixture cloud",
    status: "ready",
    error: null,
    source_path: "D:\\clouds\\fixture.laz",
    source_size: 2_000_000,
    source_sha256: "ab".repeat(32),
    las_version: "1.2",
    point_format: 3,
    point_count: 10_201,
    has_rgb: true,
    scale: [0.001, 0.001, 0.001],
    crs_wkt: 'PROJCRS["WGS 84 / UTM zone 39N"]',
    epsg: 32639,
    proj4: "+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs",
    vertical_crs: null,
    crs_source: "file",
    bounds_native: [243500, 3178000, 0, 243600, 3178100, 2],
    bounds_repaired: true,
    bounds_wgs84: [48.3744, 28.7038, 48.3755, 28.7048],
    octree_spacing_m: 0.78125,
    z_stats: {
      min: 0,
      max: 2,
      mean: 1,
      p01: 0,
      p1: 0.02,
      p5: 0.1,
      p50: 1,
      p95: 1.9,
      p99: 1.98,
      p999: 2,
      sample_count: 10_201,
    },
    class_counts: { "1": 10_201 },
    octree_bytes: 183_640,
    captured_on: "2026-05-04",
    map_id: null,
    job_id: null,
    created_at: "2026-09-24T09:00:00Z",
    ...overrides,
  };
}

export async function jsonRoute(page: Page, pathname: string, body: unknown, status = 200): Promise<void> {
  await page.route(
    (u) => u.pathname === pathname,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status,
            contentType: "application/json",
            headers: CORS,
            body: JSON.stringify(body),
          })
        : route.fallback(),
  );
}
