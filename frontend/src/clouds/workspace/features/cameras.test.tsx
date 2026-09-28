import { renderHook, waitFor } from "@testing-library/react";
import { createRef, isValidElement, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CamerasPanelRow } from "@/clouds/cameras/CamerasPanelRow";
import { CloudCameras, type CloudCamerasProps } from "@/clouds/cameras/CloudCameras";
import { useCamerasStore } from "@/clouds/cameras/store";
import type { CloudToolId } from "@/clouds/workspace/tools";
import { cameraSet } from "@/test/cameraFixtures";
import { exampleCloud } from "@/test/cloudFixtures";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import type { FeatureContext } from "../types";
import { useCamerasFeature } from "./cameras";

const ctx = (activeTool: CloudToolId) =>
  ({
    projectId: PROJECT_ID,
    cloud: exampleCloud,
    viewer: createRef(),
    activeTool,
    search: "?from_image=img-1&px=1,2",
  }) as unknown as FeatureContext;

/**
 * `useCloudCameras` now runs unconditionally inside `useCamerasFeature` (controller Ruling 3), so
 * every `renderHook` here needs an `ApiProvider` and a fake `/cameras` route.
 */
function renderFeature(tool: CloudToolId) {
  const { api } = fakeClient([{ method: "GET", path: /\/cameras$/, body: cameraSet([]) }]);
  return renderHook(() => useCamerasFeature(ctx(tool)), {
    wrapper: ({ children }) => <TestApiProvider api={api}>{children}</TestApiProvider>,
  });
}

afterEach(() => {
  useCamerasStore.getState().reset(null);
});

describe("useCamerasFeature", () => {
  it("adds the photo tool, the cameras layer and the panel row", () => {
    const { result } = renderFeature("orbit");
    const f = result.current;
    expect(f.name).toBe("cameras");
    expect(f.tools?.map((t) => [t.id, t.picks])).toEqual([["photo", false]]);
    expect(isValidElement(f.layer) && f.layer.type).toBe(CloudCameras);
    expect(isValidElement(f.cloudPanel) && f.cloudPanel.type).toBe(CamerasPanelRow);
  });

  it("passes the armed tool and the route's search to the layer", () => {
    const { result } = renderFeature("photo");
    const props = (result.current.layer as ReactElement<CloudCamerasProps>).props;
    expect(props).toMatchObject({
      projectId: PROJECT_ID,
      cloud: exampleCloud,
      tool: "photo",
      search: "?from_image=img-1&px=1,2",
    });
  });

  it("loads the cameras even when the view is not running", async () => {
    const set = cameraSet([{ id: "on", x: 1, y: 1, z: 30, yaw: 0, pitch: -90 }]);
    const { api } = fakeClient([{ method: "GET", path: /\/cameras$/, body: set }]);
    const { unmount } = renderHook(() => useCamerasFeature(ctx("orbit")), {
      wrapper: ({ children }) => <TestApiProvider api={api}>{children}</TestApiProvider>,
    });
    await waitFor(() => expect(useCamerasStore.getState().status).toBe("ready"));
    expect(useCamerasStore.getState().set?.image_id).toEqual(["on"]);
    unmount();
  });
});
