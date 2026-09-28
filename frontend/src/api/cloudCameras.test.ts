import { describe, expect, it } from "vitest";
import { ApiFailure } from "@/api/errors";
import { errorBody, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { CLOUD_ID } from "@/test/cloudFixtures";
import { cameraSet, SOURCE_A } from "@/test/cameraFixtures";
import { getCloudCameras, setCloudCameraOffset } from "./cloudCameras";

describe("cloud cameras api", () => {
  it("reads the cameras payload of a cloud", async () => {
    const set = cameraSet([{ x: 1, y: 2, z: 3 }]);
    const { api, requests } = fakeClient([{ method: "GET", path: /\/cameras$/, body: set }]);
    expect(await getCloudCameras(api, PROJECT_ID, CLOUD_ID)).toEqual(set);
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/pointclouds/${CLOUD_ID}/cameras`);
  });

  it("surfaces 409 needs_coordinates as an ApiFailure with that code", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/cameras$/,
        status: 409,
        body: errorBody("needs_coordinates", "assign a CRS first"),
      },
    ]);
    const err = await getCloudCameras(api, PROJECT_ID, CLOUD_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).code).toBe("needs_coordinates");
  });

  it("puts one image set's height offset", async () => {
    const source = { id: SOURCE_A, label: "Flight 14 Sep", count: 2, height_offset_m: -31.5, posed_count: 1 };
    const { api, requests } = fakeClient([{ method: "PUT", path: /\/cameras\/offsets\//, body: source }]);
    expect(await setCloudCameraOffset(api, PROJECT_ID, CLOUD_ID, SOURCE_A, -31.5)).toEqual(source);
    expect(requests[0]).toMatchObject({
      method: "PUT",
      url: `/api/v1/projects/${PROJECT_ID}/pointclouds/${CLOUD_ID}/cameras/offsets/${SOURCE_A}`,
      body: { height_offset_m: -31.5 },
    });
  });
});
