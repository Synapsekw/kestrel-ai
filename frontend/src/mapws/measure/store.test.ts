import { beforeEach, describe, expect, it } from "vitest";
import { MEASURE_ID, measurement } from "@/mapws/test/w3Fixtures";
import { profileView } from "./results";
import { useMeasurementsStore } from "./store";

const full = measurement("profile");
/** A listed profile row: the server sends no stations or series in a list (M-W3 A13/A14). */
const listed = (patch: Record<string, unknown> = {}) =>
  measurement("profile", {
    results: { ...full.results, stations_m: [], series: [] },
    ...patch,
  });

describe("useMeasurementsStore.set (M-W3 A14)", () => {
  beforeEach(() => {
    useMeasurementsStore.getState().set([], false);
  });

  it("a list re-read keeps the full profile the inspector wrote when the row is unchanged", () => {
    useMeasurementsStore.getState().set([listed()], false);
    useMeasurementsStore.getState().patch(MEASURE_ID, { results: full.results });
    useMeasurementsStore.getState().set([listed({ name: "Renamed" })], true);
    const row = useMeasurementsStore.getState().items[0];
    expect(row.name).toBe("Renamed");
    expect(profileView(row).hasData).toBe(true);
    expect(profileView(row).stations).toEqual([0, 10, 20, 30, 40, 50]);
    expect(useMeasurementsStore.getState().truncated).toBe(true);
  });

  it("a changed row (new updated_at) takes the listed placeholder", () => {
    useMeasurementsStore.getState().set([full], false);
    useMeasurementsStore.getState().set([listed({ updated_at: "2026-09-28T09:00:00Z" })], false);
    expect(profileView(useMeasurementsStore.getState().items[0]).hasData).toBe(false);
  });

  it("a row with fresh stations replaces the kept ones", () => {
    useMeasurementsStore.getState().set([full], false);
    const next = measurement("profile", {
      results: { ...full.results, stations_m: [0, 25, 50] },
    });
    useMeasurementsStore.getState().set([next], false);
    expect(profileView(useMeasurementsStore.getState().items[0]).stations).toEqual([0, 25, 50]);
  });

  it("drops rows the list no longer has", () => {
    useMeasurementsStore.getState().set([full], false);
    useMeasurementsStore.getState().set([], false);
    expect(useMeasurementsStore.getState().items).toEqual([]);
  });
});

describe("useMeasurementsStore.upsert (M-W3 P6)", () => {
  beforeEach(() => {
    useMeasurementsStore.getState().set([], false);
  });

  it("adds a row the list has not brought yet, and a later unchanged list keeps its stations", () => {
    useMeasurementsStore.getState().upsert(full);
    useMeasurementsStore.getState().set([listed()], false);
    expect(profileView(useMeasurementsStore.getState().items[0]).stations).toEqual([0, 10, 20, 30, 40, 50]);
  });

  it("replaces a stored row but keeps its site vertices when the new row has none", () => {
    useMeasurementsStore.getState().set([full], false);
    useMeasurementsStore
      .getState()
      .upsert({ ...full, name: "Renamed", vertices_site: undefined, updated_at: "2026-09-28T08:00:00Z" });
    const row = useMeasurementsStore.getState().items[0];
    expect(row.name).toBe("Renamed");
    expect(row.updated_at).toBe("2026-09-28T08:00:00Z");
    expect(row.vertices_site).toEqual(full.vertices_site);
  });
});
