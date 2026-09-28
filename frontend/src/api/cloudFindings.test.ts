import { describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { exampleFinding, exampleFindingDetail } from "@/test/findingFixtures";
import { CLOUD_ID } from "@/test/cloudFixtures";
import type { Finding } from "./findings";
import {
  PIN_CAP,
  PIN_COUNT_PAGES,
  createCloudFinding,
  listCloudPins,
  moveCloudFinding,
  pinCapNote,
} from "./cloudFindings";

const params = (url: string) => new URL(url, "http://fake").searchParams;
const rows = (n: number, from = 0): Finding[] =>
  Array.from({ length: n }, (_, i) => ({ ...exampleFinding, id: `f-${from + i}`, number: from + i + 1 }));

describe("cloud finding API", () => {
  it("creates with exactly F's cloud anchor", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/findings$/, status: 201, body: exampleFindingDetail },
    ]);
    await createCloudFinding(api, PROJECT_ID, {
      type_id: "t-1",
      anchor: { cloud_id: CLOUD_ID, x: 1.5, y: 2.5, z: 3.5, uncertainty_m: 0.05 },
      severity: 3,
      note: "Spall",
    });
    const body = requests[0].body as { anchor: Record<string, unknown> };
    expect(Object.keys(body.anchor)).toEqual(["kind", "cloud_id", "x", "y", "z", "uncertainty_m"]);
    expect(body).toEqual({
      type_id: "t-1",
      anchor: { kind: "cloud", cloud_id: CLOUD_ID, x: 1.5, y: 2.5, z: 3.5, uncertainty_m: 0.05 },
      severity: 3,
      note: "Spall",
    });
  });

  it("moves through PATCH anchor x, y, z, uncertainty_m", async () => {
    const { api, requests } = fakeClient([
      { method: "PATCH", path: /\/findings\/f-9$/, body: exampleFindingDetail },
    ]);
    await moveCloudFinding(api, PROJECT_ID, "f-9", { x: 1, y: 2, z: 3, uncertainty_m: null });
    expect(requests[0].body).toEqual({ anchor: { x: 1, y: 2, z: 3, uncertainty_m: null } });
  });

  it("lists this cloud's findings capped at 500, highest severity first", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/findings$/, body: { items: rows(3), next_cursor: null } },
    ]);
    const page = await listCloudPins(api, PROJECT_ID, CLOUD_ID);
    expect(page).toEqual({ items: rows(3), total: 3, totalIsFloor: false });
    const p = params(requests[0].url);
    expect(p.getAll("anchor_kind")).toEqual(["cloud"]);
    expect(p.get("data_id")).toBe(CLOUD_ID);
    expect(p.get("sort")).toBe("-severity");
    expect(p.get("limit")).toBe(String(PIN_CAP));
    expect(requests).toHaveLength(1);
  });

  it("counts past the cap with at most ten extra pages", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/findings$/,
        body: (r) => {
          const n = Number(params(r.url).get("cursor") ?? "0");
          return { items: rows(PIN_CAP, n * PIN_CAP), next_cursor: String(n + 1) };
        },
      },
    ]);
    const page = await listCloudPins(api, PROJECT_ID, CLOUD_ID);
    expect(page.items).toHaveLength(PIN_CAP);
    expect(page.total).toBe(PIN_CAP * (PIN_COUNT_PAGES + 1));
    expect(page.totalIsFloor).toBe(true);
    expect(requests).toHaveLength(PIN_COUNT_PAGES + 1);
  });

  it("stops counting on a repeated cursor", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/findings$/, body: { items: rows(PIN_CAP), next_cursor: "same" } },
    ]);
    const page = await listCloudPins(api, PROJECT_ID, CLOUD_ID);
    expect(requests).toHaveLength(2);
    expect(page).toMatchObject({ total: 2 * PIN_CAP, totalIsFloor: false });
  });

  it("writes the cap note only when pins are left out", () => {
    expect(pinCapNote({ items: rows(3), total: 3, totalIsFloor: false })).toBeNull();
    expect(pinCapNote({ items: rows(PIN_CAP), total: 812, totalIsFloor: false })).toBe(
      "500 of 812 pins shown",
    );
    expect(pinCapNote({ items: rows(PIN_CAP), total: 5500, totalIsFloor: true })).toBe(
      "500 of 5,500+ pins shown",
    );
  });
});
