import { describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { MEASUREMENTS_LAYER_MAX, MEASUREMENTS_PAGE, listMapMeasurementsInFrame } from "./mapMeasurements";

const row = (i: number) => ({
  id: `m${i}`,
  name: `Distance ${i}`,
  kind: "distance",
});

describe("listMapMeasurementsInFrame", () => {
  it("reads in the site frame, 500 a page, and stops at the cap", async () => {
    let n = 0;
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/map-measurements$/,
        body: () => ({
          items: Array.from({ length: MEASUREMENTS_PAGE }, () => row(n++)),
          next_cursor: `c${n}`,
        }),
      },
    ]);
    const out = await listMapMeasurementsInFrame(api, PROJECT_ID);
    expect(out.items).toHaveLength(MEASUREMENTS_LAYER_MAX);
    expect(out.truncated).toBe(true);
    expect(requests).toHaveLength(MEASUREMENTS_LAYER_MAX / MEASUREMENTS_PAGE);
    expect(requests[0].url).toContain("frame=site");
    expect(requests[0].url).toContain(`limit=${MEASUREMENTS_PAGE}`);
  });

  it("stops when the cursor repeats (the Prism mock) and is not truncated", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/map-measurements$/,
        body: { items: [row(1)], next_cursor: "string" },
      },
    ]);
    const out = await listMapMeasurementsInFrame(api, PROJECT_ID);
    expect(out.items).toHaveLength(1);
    expect(out.truncated).toBe(false);
    expect(requests.length).toBeLessThanOrEqual(2);
  });

  it("a full cap with no more data (the last page's cursor is null) is not truncated", async () => {
    let n = 0;
    let page = 0;
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/map-measurements$/,
        body: () => {
          page += 1;
          return {
            items: Array.from({ length: MEASUREMENTS_PAGE }, () => row(n++)),
            next_cursor: page < MEASUREMENTS_LAYER_MAX / MEASUREMENTS_PAGE ? `c${page}` : null,
          };
        },
      },
    ]);
    const out = await listMapMeasurementsInFrame(api, PROJECT_ID);
    expect(out.items).toHaveLength(MEASUREMENTS_LAYER_MAX);
    expect(out.truncated).toBe(false);
    expect(requests).toHaveLength(MEASUREMENTS_LAYER_MAX / MEASUREMENTS_PAGE);
  });
});
