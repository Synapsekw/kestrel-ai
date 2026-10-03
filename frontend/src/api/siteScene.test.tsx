import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createApiClient } from "@contract/client";
import { fakeClient, fakeFetch } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { EMPTY_SCENE, FRAME_ONLY_SCENE, MODEL_SCENE, TEST_FRAME } from "@/test/siteSceneFixtures";
import { absUrl, getSiteScene, listAssetItems, siteModelUrl, toFrameT, useSiteScene } from "./siteScene";

describe("siteScene api", () => {
  it("asks for the scene with and without a model id", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/site-scene/, body: MODEL_SCENE }]);
    expect(await getSiteScene(api, "p1")).toEqual(MODEL_SCENE);
    await getSiteScene(api, "p1", "m1");
    expect(requests[0].url).toBe("/api/v1/projects/p1/site-scene");
    expect(requests[1].url).toBe("/api/v1/projects/p1/site-scene?modelId=m1");
  });

  it("absUrl adds the base and the token to a server-relative path", () => {
    const info = { baseUrl: "http://127.0.0.1:8000/", token: "a b" };
    expect(absUrl(info, "/api/v1/x/glb")).toBe("http://127.0.0.1:8000/api/v1/x/glb?token=a%20b");
    expect(absUrl(info, "/api/v1/t/{z}/{x}/{y}?v=1")).toBe(
      "http://127.0.0.1:8000/api/v1/t/{z}/{x}/{y}?v=1&token=a%20b",
    );
  });

  it("siteModelUrl is the token-bearing GLB of one model version", () => {
    expect(siteModelUrl({ baseUrl: "http://127.0.0.1:8000/", token: "a b" }, "p1", "m1", 4)).toBe(
      "http://127.0.0.1:8000/api/v1/projects/p1/asset-models/m1/versions/4/glb?token=a+b",
    );
  });

  it("toFrameT copies the frame and keeps null", () => {
    expect(toFrameT(null)).toBeNull();
    expect(toFrameT(TEST_FRAME)).toEqual({
      crs: { epsg: 32639, wkt: null },
      origin_crs: [244338.089, 3179515.69],
      plant_north_deg: 17.9991,
      datum: { label: "HPFS", el_m: 100 },
    });
  });

  it("useSiteScene loads, reports an error and keeps the last scene", async () => {
    let fail = false;
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/site-scene/,
        status: () => (fail ? 500 : 200),
        body: () => (fail ? { error: { code: "boom", message: "it broke", details: {} } } : EMPTY_SCENE),
      },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useSiteScene("p1"), { wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.scene).toEqual(EMPTY_SCENE));
    fail = true;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBe("it broke"));
    expect(result.current.scene).toEqual(EMPTY_SCENE);
  });

  it("useSiteScene drops an older reload's answer that lands after a newer one", async () => {
    const bodies = [EMPTY_SCENE, MODEL_SCENE, FRAME_ONLY_SCENE];
    let n = 0;
    const { fetch: inner } = fakeFetch([{ method: "GET", path: /\/site-scene/, body: () => bodies[n++] }]);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const gated = (async (input: Request | string | URL, init?: RequestInit) => {
      calls += 1;
      if (calls === 2) {
        const res = await inner(input, init); // takes MODEL_SCENE now, answers late
        await gate;
        return res;
      }
      return inner(input, init);
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: gated });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useSiteScene("p1"), { wrapper });
    await waitFor(() => expect(result.current.scene).toEqual(EMPTY_SCENE));
    act(() => result.current.reload()); // older: MODEL_SCENE, held
    act(() => result.current.reload()); // newer: FRAME_ONLY_SCENE
    await waitFor(() => expect(result.current.scene).toEqual(FRAME_ONLY_SCENE));
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(calls).toBe(3);
    expect(result.current.scene).toEqual(FRAME_ONLY_SCENE);
  });

  it("listAssetItems sends the filters", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/items/, body: { items: [], next_cursor: null } },
    ]);
    await listAssetItems(api, "p1", "m1", 1, { type: "tank_lng", limit: 50 }, "x");
    expect(requests[0].url).toBe(
      "/api/v1/projects/p1/asset-models/m1/versions/1/items?type=tank_lng&limit=50&cursor=x",
    );
  });
});
