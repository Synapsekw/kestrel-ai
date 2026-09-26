import { describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import {
  createDesignInspection,
  createDesignPreview,
  createDesignSurface,
  deleteDesignInspection,
  designPreviewImageUrl,
  designThumbnailUrl,
  listTargetSurfaces,
} from "./designSurfaces";
import { designSurface, exampleTarget, INSPECTION_ID, PREVIEW_ID } from "@/surfaces/testFixtures";

describe("designSurfaces api", () => {
  it("posts the path to create an inspection", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/design-inspections$/, status: 202, body: { inspection: {}, job: {} } },
    ]);
    await createDesignInspection(api, PROJECT_ID, "D:\\x.xml");
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/design-inspections`);
    expect(requests[0].body).toEqual({ path: "D:\\x.xml" });
  });

  it("posts options to the inspection's previews and deletes the inspection", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/previews$/, status: 202, body: { preview: {}, job: {} } },
      { method: "DELETE", path: /\/design-inspections\/[^/]+$/, status: 204 },
    ]);
    const body = {
      candidate_ids: ["c0"],
      source_crs: "EPSG:32639",
      horizontal_unit: "metre" as const,
      vertical_unit: "metre" as const,
    };
    await createDesignPreview(api, PROJECT_ID, INSPECTION_ID, body);
    await deleteDesignInspection(api, PROJECT_ID, INSPECTION_ID);
    expect(requests[0].url).toBe(
      `/api/v1/projects/${PROJECT_ID}/design-inspections/${INSPECTION_ID}/previews`,
    );
    expect(requests[0].body).toEqual(body);
    expect(requests[1].method).toBe("DELETE");
  });

  it("creates the design surface", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/design-surfaces$/, status: 202, body: { surface: designSurface, job: {} } },
    ]);
    const r = await createDesignSurface(api, PROJECT_ID, {
      inspection_id: INSPECTION_ID,
      preview_id: PREVIEW_ID,
      accept_warnings: true,
    });
    expect(r.surface.kind).toBe("design");
    expect(requests[0].body).toEqual({
      inspection_id: INSPECTION_ID,
      preview_id: PREVIEW_ID,
      accept_warnings: true,
    });
  });

  it("offers only ready cloud surfaces as targets", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/surfaces$/,
        body: { items: [exampleTarget, designSurface, { ...exampleTarget, id: "x", status: "building" }] },
      },
    ]);
    expect((await listTargetSurfaces(api, PROJECT_ID)).map((s) => s.id)).toEqual([exampleTarget.id]);
  });

  it("builds token-carrying image urls", () => {
    expect(designThumbnailUrl("http://h/", "t k", "p", "i", "c0")).toBe(
      "http://h/api/v1/projects/p/design-inspections/i/candidates/c0/thumbnail?token=t+k",
    );
    expect(designPreviewImageUrl("http://h", "t", "p", "i", "v")).toBe(
      "http://h/api/v1/projects/p/design-inspections/i/previews/v/image?token=t",
    );
  });
});
