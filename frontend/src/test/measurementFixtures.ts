import type { MeasurementItem } from "@/api/measurements";

export const MAP_MEASUREMENT_ID = "e0000000-1212-4000-8000-000000000001";
export const CLOUD_MEASUREMENT_ID = "e0000000-1212-4000-8000-000000000002";
export const VOLUME_MEASUREMENT_ID = "e0000000-1212-4000-8000-000000000003";
export const UNKNOWN_MEASUREMENT_ID = "e0000000-1212-4000-8000-000000000004";
export const CLOUD_DATA_ID = "c0000000-8888-4000-8000-000000000001";

/** A row of the union; the cast tolerates extra required fields M-C0 may add. */
export function measurementItem(n: number, over: Record<string, unknown> = {}): MeasurementItem {
  return {
    kind: "map",
    sub_kind: "distance",
    id: `m-${n}`,
    name: `Line ${n}`,
    headline: 10 + n,
    unit: "m",
    data_type: "map",
    data_id: "a0000000-6666-4000-8000-000000000001",
    status: "ready",
    updated_at: "2026-09-27T10:00:00Z",
    ...over,
  } as unknown as MeasurementItem;
}

export const MAP_MEASUREMENT = measurementItem(1, {
  id: MAP_MEASUREMENT_ID,
  name: "Fence line",
  headline: 12.5,
});
export const CLOUD_MEASUREMENT = measurementItem(2, {
  kind: "cloud",
  sub_kind: "height",
  id: CLOUD_MEASUREMENT_ID,
  name: "Mast height",
  headline: 31.25,
  data_type: "point_cloud",
  data_id: CLOUD_DATA_ID,
});
export const VOLUME_MEASUREMENT = measurementItem(3, {
  kind: "volume",
  sub_kind: "volume",
  id: VOLUME_MEASUREMENT_ID,
  name: "Pile 1",
  headline: 1234.5,
  unit: "m3",
  data_type: "elevation",
  data_id: "s0000000-9999-4000-8000-000000000001",
  status: "stale",
});
/** A cloud sub-kind this client does not know yet, still computing, with no headline. */
export const UNKNOWN_MEASUREMENT = measurementItem(4, {
  kind: "cloud",
  sub_kind: "slope_angle",
  id: UNKNOWN_MEASUREMENT_ID,
  name: "Slope A",
  headline: null,
  unit: null,
  data_type: "point_cloud",
  data_id: CLOUD_DATA_ID,
  status: "computing",
});
