import { describe, expect, it } from "vitest";
import { fakeClient } from "@/test/fixtures";
import { MEASUREMENT_ID, PROJECT_ID, exampleMeasurement } from "@/test/volumeFixtures";
import { fetchFootprintsSite, fetchVolumeSite } from "./volumes";

describe("volumes in the site frame", () => {
  it("asks for frame=site", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/volumes\/[^/]+$/, body: exampleMeasurement },
      {
        method: "GET",
        path: /\/footprints$/,
        body: { items: [], truncated: false },
      },
    ]);
    await fetchVolumeSite(api, PROJECT_ID, MEASUREMENT_ID);
    await fetchFootprintsSite(api, PROJECT_ID, MEASUREMENT_ID);
    expect(requests.map((r) => r.url.includes("frame=site"))).toEqual([true, true]);
  });
});
