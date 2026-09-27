import { describe, it, expect } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { deleteImages } from "./bulkActions";

describe("bulk actions", () => {
  it("posts a bulk delete with the image ids", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/images\/bulk-delete$/, body: { deleted: 2 } },
    ]);
    expect(await deleteImages(api, PROJECT_ID, ["a", "b"])).toBe(2);
    expect(requests[0].body).toEqual({ image_ids: ["a", "b"] });
  });
});
