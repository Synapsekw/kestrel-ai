import { describe, it, expect } from "vitest";
import {
  exampleImage,
  exampleImagePage,
  fakeClient,
  PROJECT_ID,
  IMAGE_ID,
  proposalBox,
  errorBody,
} from "@/test/fixtures";
import {
  bulkDeleteImages,
  bulkMarkEmpty,
  fetchImage,
  fetchImagePage,
  preannotateImage,
  REVIEW_QUEUE_QUERY,
  setMarkedEmpty,
} from "./images";
import { ApiFailure } from "./errors";

describe("images api", () => {
  it("lists with filters and sort in the query string", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/images$/, body: exampleImagePage }]);
    const page = await fetchImagePage(api, PROJECT_ID, { ...REVIEW_QUEUE_QUERY, limit: 50, search: "0031" });
    expect(page.total).toBe(2);
    const url = new URL(`http://x${requests[0].url}`);
    expect(url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/images`);
    expect(url.searchParams.get("has_pending")).toBe("true");
    expect(url.searchParams.get("sort")).toBe("max_pending_confidence");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("search")).toBe("0031");
  });

  it("gets one image and bulk-deletes", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/images\/[^/]+$/, body: exampleImage },
      { method: "POST", path: /\/images\/bulk-delete$/, body: { deleted: 2 } },
    ]);
    expect((await fetchImage(api, PROJECT_ID, IMAGE_ID)).id).toBe(IMAGE_ID);
    expect(await bulkDeleteImages(api, PROJECT_ID, ["a", "b"])).toBe(2);
    expect(requests[1]).toMatchObject({ method: "POST", body: { image_ids: ["a", "b"] } });
  });

  it("marks one image empty and bulk-marks a selection", async () => {
    const { api, requests } = fakeClient([
      { method: "PATCH", path: /\/images\/[^/]+$/, body: { ...exampleImage, marked_empty: true } },
      { method: "POST", path: /\/bulk-mark-empty$/, body: { updated: 2, skipped: 1 } },
    ]);
    const updated = await setMarkedEmpty(api, PROJECT_ID, IMAGE_ID, true);
    expect(updated.marked_empty).toBe(true);
    expect(requests[0]).toMatchObject({ method: "PATCH", body: { marked_empty: true } });

    const result = await bulkMarkEmpty(api, PROJECT_ID, ["a", "b", "c"], true);
    expect(result).toEqual({ updated: 2, skipped: 1 });
    expect(requests[1]).toMatchObject({
      method: "POST",
      body: { image_ids: ["a", "b", "c"], marked_empty: true },
    });
  });

  it("pre-annotates with no body and surfaces 501 as ApiFailure", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/preannotate$/,
        body: { skipped: false, model_id: "m", items: [proposalBox] },
      },
    ]);
    const r = await preannotateImage(api, PROJECT_ID, IMAGE_ID);
    expect(r.items).toHaveLength(1);
    expect(requests[0].body).toBeNull();
    const stub = fakeClient([
      { method: "POST", path: /\/preannotate$/, status: 501, body: errorBody("not_implemented", "S4 later") },
    ]);
    await expect(preannotateImage(stub.api, PROJECT_ID, IMAGE_ID)).rejects.toMatchObject({
      code: "not_implemented",
      status: 501,
    });
    await expect(preannotateImage(stub.api, PROJECT_ID, IMAGE_ID)).rejects.toBeInstanceOf(ApiFailure);
  });
});
