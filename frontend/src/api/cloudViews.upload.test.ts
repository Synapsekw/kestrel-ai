// @vitest-environment node
// Node's own FormData/Blob/Request: jsdom's Request cannot read a multipart body back.
import { describe, expect, it } from "vitest";
import { createApiClient, type CloudViewMeta } from "@contract/client";
import { putCloudMeasurementView3d, putFindingView3d, view3dUrl } from "./cloudViews";

const META: CloudViewMeta = {
  pose: { position: [0, -10, 10], target: [0, 0, 0], up: [0, 0, 1], fov_deg: 50 },
  render: {
    colour_mode: "rgb",
    point_budget: 3_000_000,
    point_size: 1.4,
    edl: false,
    clip_box: null,
    complete: true,
  },
  anchor_normal: [0, 1, 0],
};
const OUT = { subject_kind: "finding", subject_id: "f1", sha256: "ab" };

function recording() {
  const seen: { method: string; path: string; type: string | null; form: FormData }[] = [];
  const fetchImpl = (async (input: Request) => {
    seen.push({
      method: input.method,
      path: new URL(input.url).pathname,
      type: input.headers.get("content-type"),
      form: await input.formData(),
    });
    return new Response(JSON.stringify(OUT), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { api: createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl }), seen };
}

describe("view3d uploads", () => {
  it("PUTs a finding's view as multipart with the image and a JSON meta part", async () => {
    const { api, seen } = recording();
    const image = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    expect(await putFindingView3d(api, "p1", "f1", image, META)).toEqual(OUT);
    expect(seen[0].method).toBe("PUT");
    expect(seen[0].path).toBe("/api/v1/projects/p1/findings/f1/view3d");
    expect(seen[0].type).toMatch(/^multipart\/form-data; boundary=/);
    const file = seen[0].form.get("image") as File;
    expect(file.name).toBe("view.png");
    expect(file.size).toBe(4);
    const meta = seen[0].form.get("meta") as File;
    expect(meta.type).toBe("application/json");
    expect(JSON.parse(await meta.text())).toEqual(META);
  });

  it("PUTs a measurement's view and names a JPEG view.jpg", async () => {
    const { api, seen } = recording();
    const image = new Blob([new Uint8Array(3)], { type: "image/jpeg" });
    await putCloudMeasurementView3d(api, "p1", "c1", "m1", image, { ...META, anchor_normal: null });
    expect(seen[0].path).toBe("/api/v1/projects/p1/pointclouds/c1/measurements/m1/view3d");
    expect((seen[0].form.get("image") as File).name).toBe("view.jpg");
  });

  it("builds a cache-busting thumbnail URL with the token", () => {
    expect(view3dUrl("http://h/", "tok", "p1", "c1", { kind: "finding", id: "f1" }, "abc")).toBe(
      "http://h/api/v1/projects/p1/findings/f1/view3d?token=tok&v=abc",
    );
    expect(view3dUrl("http://h", "tok", "p1", "c1", { kind: "cloud_measurement", id: "m1" }, "abc")).toBe(
      "http://h/api/v1/projects/p1/pointclouds/c1/measurements/m1/view3d?token=tok&v=abc",
    );
  });
});
