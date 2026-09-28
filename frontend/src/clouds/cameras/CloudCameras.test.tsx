import { waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { cameraSet } from "@/test/cameraFixtures";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { CloudCameras } from "./CloudCameras";
import { useCamerasStore } from "./store";

const E = 243550;
const N = 3178050;

/**
 * `CloudCameras` no longer runs `useCloudCameras` itself (controller Ruling 3: the fetch lives in
 * the always-mounted `useCamerasFeature`, not the layer, so a no-WebGL machine never sees the cloud
 * panel's row stuck on "Loading…"). The store is preloaded directly instead of through a route.
 */
function mount() {
  const v = {
    project: vi.fn((p: { x: number; y: number }) => ({ x: p.x - E + 400, y: N - p.y + 300 })),
    canvasRect: () => ({ left: 0, top: 0, right: 800, bottom: 600 }),
    setOverlay: vi.fn(),
    stats: () => ({ numVisiblePoints: 0, nodesLoading: 0 }),
  };
  const ref = createRef<CloudViewerHandle | null>() as { current: CloudViewerHandle | null };
  ref.current = v as unknown as CloudViewerHandle;
  const set = cameraSet([
    { id: "on", x: E, y: N, z: 30, yaw: 0, pitch: -90 },
    { id: "off", x: E + 5000, y: N, z: 30 },
  ]);
  useCamerasStore.getState().reset(CLOUD_ID);
  useCamerasStore.getState().receive(CLOUD_ID, set);
  const { api } = fakeClient([]);
  const r = renderWithProviders(
    <>
      <canvas data-testid="cloud-canvas" />
      <CloudCameras projectId={PROJECT_ID} cloud={exampleCloud} viewer={ref} tool="orbit" search="" />
    </>,
    { api, route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}` },
  );
  return { v, r };
}

afterEach(() => {
  localStorage.removeItem("kestrel.diagnostics");
  useCamerasStore.getState().reset(null);
});

describe("CloudCameras", () => {
  it("loads the cameras and draws them", async () => {
    const { v } = mount();
    expect(useCamerasStore.getState().status).toBe("ready");
    await waitFor(() =>
      expect(v.setOverlay).toHaveBeenLastCalledWith(
        "cameras",
        expect.arrayContaining([expect.objectContaining({ kind: "segments" })]),
      ),
    );
  });

  it("exposes the on-canvas glyphs to the e2e diagnostics only when diagnostics are on", async () => {
    localStorage.setItem("kestrel.diagnostics", "1");
    const { r } = mount();
    await waitFor(() => expect(window.__kestrelCloudCameras).toBeDefined());
    expect(window.__kestrelCloudCameras?.glyphs()).toEqual([{ imageId: "on", x: 400, y: 300 }]);
    expect(window.__kestrelCloudCameras?.lookingThrough()).toBe(false);
    r.unmount();
    expect(window.__kestrelCloudCameras).toBeUndefined();
  });

  it("installs no diagnostics hook by default", () => {
    mount();
    expect(window.__kestrelCloudCameras).toBeUndefined();
  });
});
