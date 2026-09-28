import { describe, expect, it } from "vitest";
import { fakeClient, runningJob } from "@/test/fixtures";
import { MEASUREMENT_ID, PROJECT_ID, exampleMeasurement } from "@/test/volumeFixtures";
import { useJobsStore } from "@/store/jobs";
import { saveVolume, touchesInputs } from "./saveVolume";

const routes = [
  {
    method: "PATCH",
    path: /\/volumes\/[^/]+$/,
    body: { ...exampleMeasurement, status: "stale" },
  },
  {
    method: "POST",
    path: /\/calculate$/,
    status: 202,
    body: {
      measurement: { ...exampleMeasurement, status: "calculating" },
      job: { ...runningJob, type: "volume_calc" },
    },
  },
];

describe("saveVolume", () => {
  it("recalculates after an input change when auto is on", async () => {
    const { api, requests } = fakeClient(routes);
    const m = await saveVolume(api, PROJECT_ID, MEASUREMENT_ID, { base: { kind: "toe_lowest" } }, true);
    expect(requests.map((r) => r.method)).toEqual(["PATCH", "POST"]);
    expect(m.status).toBe("calculating");
    expect(useJobsStore.getState().jobs[runningJob.id]?.type).toBe("volume_calc");
  });

  it("only patches when auto is off, or for a name or material", async () => {
    const { api, requests } = fakeClient(routes);
    await saveVolume(api, PROJECT_ID, MEASUREMENT_ID, { base: { kind: "toe_plane" } }, false);
    await saveVolume(
      api,
      PROJECT_ID,
      MEASUREMENT_ID,
      { material: { name: "Sand", density_t_m3: 1.6 } },
      true,
    );
    await saveVolume(api, PROJECT_ID, MEASUREMENT_ID, { name: "Pile 9" }, true);
    expect(requests.map((r) => r.method)).toEqual(["PATCH", "PATCH", "PATCH"]);
  });

  it("knows which fields are calculation inputs", () => {
    expect(
      touchesInputs({
        polygon_site: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      }),
    ).toBe(true);
    expect(touchesInputs({ masks: { buffer_m: 2 } })).toBe(true);
    expect(touchesInputs({ alignment: { apply_shift: true } })).toBe(true);
    expect(touchesInputs({ material: null })).toBe(false);
  });
});
