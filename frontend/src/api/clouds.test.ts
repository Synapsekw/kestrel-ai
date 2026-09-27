import { describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { deletePointCloud } from "./clouds";
import { ApiFailure } from "./errors";

const CLOUD = "c0000000-4444-4000-8000-000000000001";

describe("deletePointCloud", () => {
  it("sends delete_findings only when asked", async () => {
    const { api, requests } = fakeClient([
      { method: "DELETE", path: new RegExp(`/pointclouds/${CLOUD}`), status: 204, body: null },
      { method: "DELETE", path: new RegExp(`/pointclouds/${CLOUD}`), status: 204, body: null },
    ]);
    await deletePointCloud(api, PROJECT_ID, CLOUD);
    await deletePointCloud(api, PROJECT_ID, CLOUD, { deleteFindings: true });
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/pointclouds/${CLOUD}`);
    expect(requests[1].url).toBe(`/api/v1/projects/${PROJECT_ID}/pointclouds/${CLOUD}?delete_findings=true`);
  });

  it("surfaces cloud_has_findings with its count", async () => {
    const { api } = fakeClient([
      {
        method: "DELETE",
        path: new RegExp(`/pointclouds/${CLOUD}`),
        status: 409,
        body: {
          error: { code: "cloud_has_findings", message: "Chimney has 3 findings", details: { count: 3 } },
        },
      },
    ]);
    const err = await deletePointCloud(api, PROJECT_ID, CLOUD).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).code).toBe("cloud_has_findings");
    expect((err as ApiFailure).details).toEqual({ count: 3 });
  });
});
