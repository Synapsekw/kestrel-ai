import { describe, expect, it, vi } from "vitest";
import { makeRequestManager, metadataUrl, withToken } from "./requestManager";

const META = "http://127.0.0.1:8765/api/v1/projects/p/pointclouds/c/octree/metadata.json";

describe("octree request manager", () => {
  it("appends the token once", async () => {
    const rm = makeRequestManager("s3cret");
    const url = await rm.getUrl(META);
    expect(url).toBe(`${META}?token=s3cret`);
    expect(await rm.getUrl(url)).toBe(url);
    expect(withToken(`${META}?token=already`, "other")).toBe(`${META}?token=already`);
  });

  it("keeps the token through potree-core's /metadata.json replace", async () => {
    const url = await makeRequestManager("s3cret").getUrl(META);
    expect(url.replace("/metadata.json", "/octree.bin")).toBe(
      META.replace("metadata.json", "octree.bin") + "?token=s3cret",
    );
    expect(url.replace("/metadata.json", "/hierarchy.bin")).toContain("/hierarchy.bin?token=s3cret");
  });

  it("passes requests through and turns an error envelope into its message", async () => {
    const ok = new Response("{}", { status: 206 });
    const missing = new Response(
      JSON.stringify({
        error: {
          code: "octree_missing",
          message: "the 3D view copy is missing; import the file again",
          details: {},
        },
      }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce(missing);
    const rm = makeRequestManager("t", fetchImpl);
    expect(await rm.fetch("u1", { headers: { Range: "bytes=0-21" } })).toBe(ok);
    expect(fetchImpl).toHaveBeenCalledWith("u1", { headers: { Range: "bytes=0-21" } });
    await expect(rm.fetch("u2")).rejects.toThrow("the 3D view copy is missing; import the file again");
  });

  it("names the status when the error body is not an envelope", async () => {
    const rm = makeRequestManager("t", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(rm.fetch("u")).rejects.toThrow("the 3D view copy could not be loaded (HTTP 500)");
  });

  it("hands potree-core a URL that ends in metadata.json", () => {
    // potree-core 2.0.15 picks its Potree 2 loader with url.endsWith("metadata.json"): a ?token=
    // on the URL passed to loadPointCloud silently selects the Potree 1 loader instead.
    expect(metadataUrl(`${META}?token=abc`)).toBe(META);
    expect(metadataUrl(META)).toBe(META);
    expect(() => metadataUrl("http://x/octree/octree.bin")).toThrow();
  });
});
