import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PointCloud } from "@/api/clouds";
import { useChangesStore } from "@/store/changes";
import { cameraSet } from "@/test/cameraFixtures";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { errorBody, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { camerasShown, useCamerasStore } from "./store";
import { REVISION_REFETCH_MS, useCloudCameras } from "./useCloudCameras";

const OTHER = "c0000000-8888-4000-8000-000000000002";

type CamerasPath = "/api/v1/projects/{projectId}/pointclouds/{cloudId}/cameras";
/** The init shape `getCloudCameras` passes to `api.GET` for `CamerasPath` (see api/cloudCameras.ts).
 * Typed against this one endpoint rather than `Parameters<typeof api.GET>`, whose generic,
 * conditional-rest signature does not resolve to a spreadable tuple once its type parameters are
 * erased (tsc -b: TS2556 / TS2488) — same fix as `useImageIndex.test.tsx`. */
interface CamerasGetInit {
  params: { path: { projectId: string; cloudId: string } };
}

function mount(api: ReturnType<typeof fakeClient>["api"], cloud: PointCloud | null) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider api={api}>{children}</TestApiProvider>
  );
  return renderHook(({ c }) => useCloudCameras(PROJECT_ID, c), { wrapper, initialProps: { c: cloud } });
}

afterEach(() => {
  useCamerasStore.getState().reset(null);
  vi.useRealTimers();
});

describe("useCloudCameras", () => {
  it("fetches once per cloud open, and coalesces images.changed / pointclouds.changed behind a pause", async () => {
    vi.useFakeTimers();
    const set = cameraSet([{ x: 1, y: 2, z: 3 }]);
    const { api, requests } = fakeClient([{ method: "GET", path: /\/cameras$/, body: set }]);
    mount(api, exampleCloud);
    await vi.advanceTimersByTimeAsync(0);
    expect(useCamerasStore.getState().status).toBe("ready");
    expect(useCamerasStore.getState().set).toEqual(set);
    expect(requests).toHaveLength(1);

    act(() => useChangesStore.getState().bumpImages());
    // a bump alone does not fetch until the pause has elapsed
    await vi.advanceTimersByTimeAsync(REVISION_REFETCH_MS - 100);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(requests).toHaveLength(2);

    // pointclouds.changed (an offset saved here or in another window) refetches too
    act(() => useChangesStore.setState((s) => ({ pointcloudsRevision: s.pointcloudsRevision + 1 })));
    await vi.advanceTimersByTimeAsync(REVISION_REFETCH_MS);
    expect(requests).toHaveLength(3);
  });

  it("a re-run of the effect with nothing changed (StrictMode's mount, unmount, mount) sends no second GET", async () => {
    // A second GET a pause later landed a fresh `set` object after the view had settled: the glyph
    // overlay was set again, the render loop woke for another second (clouds.spec.ts idle check).
    vi.useFakeTimers();
    const { api, requests } = fakeClient([{ method: "GET", path: /\/cameras$/, body: cameraSet([]) }]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <TestApiProvider api={api}>{children}</TestApiProvider>
      </StrictMode>
    );
    renderHook(() => useCloudCameras(PROJECT_ID, exampleCloud), { wrapper });
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(REVISION_REFETCH_MS * 3);
    expect(requests).toHaveLength(1);

    // a real bump still refetches after the pause
    act(() => useChangesStore.getState().bumpImages());
    await vi.advanceTimersByTimeAsync(REVISION_REFETCH_MS);
    expect(requests).toHaveLength(2);
  });

  it("a burst of revision bumps sends one GET after the pause", async () => {
    vi.useFakeTimers();
    const set = cameraSet([{ x: 1, y: 2, z: 3 }]);
    const { api, requests } = fakeClient([{ method: "GET", path: /\/cameras$/, body: set }]);
    mount(api, exampleCloud);
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(1);

    act(() => useChangesStore.getState().bumpImages());
    await vi.advanceTimersByTimeAsync(REVISION_REFETCH_MS - 100);
    act(() => useChangesStore.getState().bumpImages());
    await vi.advanceTimersByTimeAsync(REVISION_REFETCH_MS - 100);
    act(() => useChangesStore.getState().bumpImages());
    // each bump restarts the pause, so 1800 ms of (broken-up) quiet is not enough
    expect(requests).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(REVISION_REFETCH_MS);
    expect(requests).toHaveLength(2);
  });

  it("marks a cloud without coordinates, and refetches once it has a CRS", async () => {
    let crs = false;
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/cameras$/,
        status: () => (crs ? 200 : 409),
        body: () => (crs ? cameraSet([]) : errorBody("needs_coordinates", "no CRS")),
      },
    ]);
    const bare = { ...exampleCloud, epsg: null, proj4: null };
    const h = mount(api, bare);
    await waitFor(() => expect(useCamerasStore.getState().status).toBe("needs_coordinates"));
    crs = true;
    h.rerender({ c: exampleCloud });
    await waitFor(() => expect(useCamerasStore.getState().status).toBe("ready"));
    expect(requests).toHaveLength(2);
  });

  it("does not fetch for a cloud that is not ready", () => {
    const { api, requests } = fakeClient([]);
    mount(api, { ...exampleCloud, status: "importing" });
    expect(requests).toHaveLength(0);
    expect(useCamerasStore.getState().status).toBe("idle");
  });

  it("a late answer for the previous cloud is dropped", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const first = cameraSet([{ x: 1, y: 1, z: 1 }]);
    const second = cameraSet([{ x: 2, y: 2, z: 2 }]);
    const { api } = fakeClient([
      { method: "GET", path: new RegExp(`${CLOUD_ID}/cameras$`), body: first },
      { method: "GET", path: new RegExp(`${OTHER}/cameras$`), body: second },
    ]);
    const slow: typeof api = {
      ...api,
      GET: (async (path: CamerasPath, init: CamerasGetInit) => {
        if (init.params.path.cloudId === CLOUD_ID) await gate;
        return api.GET(path, { ...init });
      }) as typeof api.GET,
    };
    const h = mount(slow, exampleCloud);
    h.rerender({ c: { ...exampleCloud, id: OTHER } });
    await waitFor(() => expect(useCamerasStore.getState().set).toEqual(second));
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(useCamerasStore.getState().set).toEqual(second);
    expect(useCamerasStore.getState().cloudId).toBe(OTHER);
  });

  it("an older answer for the same cloud is dropped", async () => {
    const first = cameraSet([{ x: 1, y: 1, z: 1 }]);
    const second = cameraSet([{ x: 9, y: 9, z: 9 }]);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const base = fakeClient([]).api;
    let calls = 0;
    const api: typeof base = {
      ...base,
      GET: (async () => {
        calls += 1;
        const mine = calls;
        if (mine === 1) await gate;
        return {
          data: mine === 1 ? first : second,
          error: undefined,
          response: new Response(null, { status: 200 }),
        };
      }) as typeof base.GET,
    };
    // the initial open issues the first (gated) request; reload() issues a second, faster one for
    // the same cloud before the first answers
    mount(api, exampleCloud);
    act(() => useCamerasStore.getState().reload());
    await waitFor(() => expect(useCamerasStore.getState().set).toEqual(second));
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(useCamerasStore.getState().set).toEqual(second);
  });

  it("shows the cameras by default when any exist, and remembers the operator's choice", () => {
    const s = useCamerasStore.getState();
    s.reset(CLOUD_ID);
    s.receive(CLOUD_ID, cameraSet([{ x: 1, y: 1, z: 1 }]));
    expect(camerasShown(useCamerasStore.getState())).toBe(true);
    useCamerasStore.getState().setVisible(false);
    expect(camerasShown(useCamerasStore.getState())).toBe(false);
    useCamerasStore.getState().receive(CLOUD_ID, cameraSet([]));
    useCamerasStore.getState().setVisible(true);
    expect(camerasShown(useCamerasStore.getState())).toBe(false);
  });
});
