import { describe, expect, it } from "vitest";
import { exampleJob, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { CLOUD_ID } from "@/test/cloudFixtures";
import { createCloudMeasurement, getCloudProfile, retryCloudProfile } from "./cloudMeasurements";

const row = { id: "m1", point_cloud_id: CLOUD_ID, kind: "profile", status: "computing" };

describe("cloud measurement wrappers", () => {
  it("normalises a 201 to a measurement without a job", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/measurements$/,
        status: 201,
        body: { ...row, kind: "distance", status: "ready" },
      },
    ]);
    const r = await createCloudMeasurement(api, PROJECT_ID, CLOUD_ID, { kind: "distance", points: [] });
    expect(r.measurement.id).toBe("m1");
    expect(r.job).toBeNull();
  });

  it("normalises a profile's 202 to the measurement and its job", async () => {
    const { api } = fakeClient([
      { method: "POST", path: /\/measurements$/, status: 202, body: { measurement: row, job: exampleJob } },
    ]);
    const r = await createCloudMeasurement(api, PROJECT_ID, CLOUD_ID, { kind: "profile", points: [] });
    expect(r.measurement.status).toBe("computing");
    expect(r.job?.id).toBe(exampleJob.id);
  });

  it("retries a failed profile and answers its job", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/measurements\/m1\/retry$/, status: 202, body: { job: exampleJob } },
    ]);
    expect((await retryCloudProfile(api, PROJECT_ID, CLOUD_ID, "m1")).id).toBe(exampleJob.id);
    expect(requests[0].method).toBe("POST");
  });

  it("reads a stored profile", async () => {
    const profile = { s: [0, 1], z: [5, 6], rgb: null, count: 2, thickness_m: 0.2, length_m: 1 };
    const { api } = fakeClient([{ method: "GET", path: /\/measurements\/m1\/profile$/, body: profile }]);
    expect(await getCloudProfile(api, PROJECT_ID, CLOUD_ID, "m1")).toEqual(profile);
  });
});
