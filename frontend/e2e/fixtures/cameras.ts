import type { Page } from "@playwright/test";
import { CLOUD, jsonRoute } from "./clouds";

/** Over the centre of the red/green fixture grid (243500..243600, 3178000..3178100, z 0..2). */
export const E = 243550;
export const N = 3178050;
export const NADIR = "i0000000-5555-4000-8000-0000000000a1";
export const PLAIN = "i0000000-5555-4000-8000-0000000000a2";
export const SOURCE = "s0000000-3333-4000-8000-000000000001";

/** Two drone photos 30 m up: one posed looking straight down, one with a position only (10 m east). */
export function camerasJson(overrides: Record<string, unknown> = {}) {
  return {
    image_id: [NADIR, PLAIN],
    source_idx: [0, 0],
    x: [E, E + 10],
    y: [N, N],
    z: [30, 30],
    yaw: [0, null],
    pitch: [-90, null],
    roll: [0, null],
    hfov: [73.7, 73.7],
    vfov: [53.1, 53.1],
    fov_assumed: [false, false],
    width: [2048, 2048],
    height: [1536, 1536],
    sigma_m: [3, 3],
    sources: [{ id: SOURCE, label: "Flight 14 Sep", count: 2, height_offset_m: 0, posed_count: 1 }],
    truncated: false,
    z_p1: 0.02,
    z_p99: 1.98,
    without_gps: 3,
    ...overrides,
  };
}

export async function routeCameras(
  page: Page,
  projectId: string,
  body: unknown = camerasJson(),
  status = 200,
) {
  await jsonRoute(page, `/api/v1/projects/${projectId}/pointclouds/${CLOUD}/cameras`, body, status);
}

/**
 * A `CloudCameraSet` with no photos: every parallel array empty, matching the schema
 * (`contract/openapi.yaml`). For specs outside `clouds-cameras.spec.ts` that open a cloud without
 * caring about cameras — without this, the request falls through to the Prism mock, whose
 * `CloudCameraSet` example now draws a frustum and a warn-point glyph (C-L1), which can add a stray
 * render frame or a stray drawn point to a test that samples colours or counts idle frames.
 */
export function emptyCameras(): Record<string, unknown> {
  return {
    image_id: [],
    source_idx: [],
    x: [],
    y: [],
    z: [],
    yaw: [],
    pitch: [],
    roll: [],
    hfov: [],
    vfov: [],
    fov_assumed: [],
    width: [],
    height: [],
    sigma_m: [],
    sources: [],
    truncated: false,
    z_p1: null,
    z_p99: null,
    without_gps: 0,
  };
}

/**
 * A full `ImageDetail` row (GET /images/{id} answers `ImageDetail`, contract/openapi.yaml): `Image`'s
 * fields plus the required `finding_count`, `worst_severity`, `reviewed`, `camera`, `footprint` and
 * `footprint_kind` (the schema grew past the brief's `Image`-only fixture).
 */
export async function routeImageRow(page: Page, projectId: string, imageId: string, fileName: string) {
  await jsonRoute(page, `/api/v1/projects/${projectId}/images/${imageId}`, {
    id: imageId,
    path: `images/flight/${fileName}`,
    file_name: fileName,
    width: 2048,
    height: 1536,
    source_id: SOURCE,
    group_key: "0001",
    capture_time: "2026-05-04T08:12:00Z",
    lat: 28.7043,
    lon: 48.375,
    alt: 30,
    phash: null,
    box_count: 0,
    pending_count: 0,
    max_pending_confidence: null,
    labeled: false,
    marked_empty: false,
    created_at: "2026-05-04T09:00:00Z",
    finding_count: 0,
    worst_severity: null,
    reviewed: false,
    camera: {
      rel_alt: 30,
      gimbal_pitch: -90,
      gimbal_yaw: 0,
      focal_mm: 8.8,
      focal_px: 1665.7,
      sensor_w_mm: 13.2,
      lrf_distance_m: null,
      subject_distance_m: null,
      distance_m: 30,
      distance_sigma_m: 3,
      distance_source: "rel_alt",
      gsd_mm: 8.5,
      camera_model: "FC7303",
    },
    footprint: null,
    footprint_kind: "none",
  });
}
