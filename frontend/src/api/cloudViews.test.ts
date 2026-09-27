import { describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { listCloudViews } from "./cloudViews";

const CLOUD = "c0000000-4444-4000-8000-000000000001";

describe("listCloudViews", () => {
  it("reads the cloud's report-view metadata", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: new RegExp(`/pointclouds/${CLOUD}/views$`), body: { items: [] } },
    ]);
    await expect(listCloudViews(api, PROJECT_ID, CLOUD)).resolves.toEqual({ items: [] });
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/pointclouds/${CLOUD}/views`);
  });

  it("rejects on the 501 stub", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/views$/,
        status: 501,
        body: { error: { code: "not_implemented", message: "not implemented yet", details: {} } },
      },
    ]);
    await expect(listCloudViews(api, PROJECT_ID, CLOUD)).rejects.toMatchObject({ status: 501 });
  });
});
