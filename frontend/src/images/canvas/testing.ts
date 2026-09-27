import { createApiClient, type ApiClient, type Box } from "@contract/client";
import type { BoxWriteResult, ImageDetail, ImageMeasurement } from "@/api/shapes";
import { exampleImage, fakeFetch, IMAGE_ID, personBox, type FakeRoute } from "@/test/fixtures";

/** A Box with every shape field set; `partial` wins. */
export function makeShape(partial: Partial<Box> = {}): Box {
  const base: Box = {
    ...personBox,
    shape: "box",
    points: null,
    assist: null,
    area_px: personBox.w * personBox.h,
    updated_at: personBox.created_at,
  };
  return { ...base, ...partial };
}

/** What create and update answer (C0 ruling 1): the Box plus `repaired` and `finding_id`. */
export function makeWritten(partial: Partial<BoxWriteResult> = {}): BoxWriteResult {
  return { ...makeShape(partial), repaired: false, finding_id: null, ...partial };
}

/** An ImageDetail at 4000 × 3000 with a nadir camera at 40 m and GSD 2 mm/px. */
export function makeDetail(partial: Partial<ImageDetail> = {}): ImageDetail {
  const base = {
    ...exampleImage,
    width: 4000,
    height: 3000,
    camera: {
      rel_alt: 40,
      gimbal_pitch: -90,
      gimbal_yaw: 0,
      focal_mm: 12.29,
      focal_px: null,
      sensor_w_mm: 17.3,
      lrf_distance_m: null,
      subject_distance_m: null,
      distance_m: 40,
      distance_sigma_m: 1,
      distance_source: "rel_alt",
      gsd_mm: 2,
      camera_model: "M3E",
    },
    footprint: null,
    footprint_kind: "none",
  };
  return { ...base, ...partial } as ImageDetail;
}

export function makeMeasurement(partial: Partial<ImageMeasurement> = {}): ImageMeasurement {
  const base = {
    id: "me000000-0000-4000-8000-000000000001",
    image_id: IMAGE_ID,
    x1: 100,
    y1: 100,
    x2: 400,
    y2: 500,
    label: "",
    length_px: 500,
    length_mm: null,
    sigma_mm: null,
    created_at: "2026-09-27T10:00:00Z",
  };
  return { ...base, ...partial } as ImageMeasurement;
}

/**
 * A fake client whose `method` requests wait at a gate until the test calls `release()` (one
 * request per call), so a test can hold a save in flight. `arrived` counts requests at the gate.
 */
export function gatedClient(routes: FakeRoute[], method = "PATCH") {
  const { fetch: inner, requests } = fakeFetch(routes);
  const waiting: Array<() => void> = [];
  const gate = { arrived: 0, release: () => waiting.shift()?.() };
  const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
    const m = input instanceof Request ? input.method : (init?.method ?? "GET");
    if (m === method) {
      gate.arrived += 1;
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    return inner(input, init);
  }) as typeof fetch;
  const api: ApiClient = createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl });
  return { api, requests, gate };
}
