/* Test-only builders for the browser's index and detail rows; imported by *.test.tsx only. */
import type { Image as ImageRow } from "@contract/client";
import { exampleImage } from "@/test/fixtures";
import type { ImageIndexResponse } from "./api";
import { FLAG_GPS, FLAG_REVIEWED, toIndexData, type ImageIndexState } from "./useImageIndex";

export const idAt = (i: number): string => `img-${i}`;

/** `n` rows; every 3rd has GPS, every 5th has 2 findings of severity 3, every 7th is reviewed. */
export function makeIndexResponse(n: number): ImageIndexResponse {
  const ids: string[] = [];
  const sev: number[] = [];
  const count: number[] = [];
  const flags: number[] = [];
  const lon: (number | null)[] = [];
  const lat: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(idAt(i));
    const gps = i % 3 === 0;
    sev.push(i % 5 === 0 ? 3 : 0);
    count.push(i % 5 === 0 ? 2 : 0);
    flags.push((gps ? FLAG_GPS : 0) | (i % 7 === 0 ? FLAG_REVIEWED : 0));
    lon.push(gps ? 55.29 + i * 1e-5 : null);
    lat.push(gps ? 25.26 + i * 1e-5 : null);
  }
  return { total: n, ids, sev, count, flags, lon, lat } as ImageIndexResponse;
}

export function makeIndexState(n: number, over: Partial<ImageIndexState> = {}): ImageIndexState {
  const data = toIndexData(makeIndexResponse(n));
  const at = new Map(data.ids.map((id, i) => [id, i]));
  return {
    ...data,
    status: "ready",
    error: null,
    errorCode: null,
    ordinalOf: (id) => (id === null ? -1 : (at.get(id) ?? -1)),
    reload: () => {},
    ...over,
  };
}

export function imageRow(id: string, i: number): ImageRow {
  return { ...exampleImage, id, file_name: `DJI_${String(i).padStart(4, "0")}.JPG`, path: `f/${id}.jpg` };
}
