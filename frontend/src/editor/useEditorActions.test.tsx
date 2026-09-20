import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { exampleImage, fakeClient, personBox, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useEditorStore } from "@/store/editor";
import { History } from "./history";
import { useEditorActions } from "./useEditorActions";

const routes: FakeRoute[] = [
  {
    method: "PATCH",
    path: /\/boxes\/[^/]+$/,
    body: (req) => ({ ...personBox, ...(req.body as object) }),
  },
];

/** Mounts the actions over a store holding `box`, with that box selected. */
function mount(box: typeof personBox) {
  const { api, requests } = fakeClient(routes);
  useEditorStore.getState().loadImage(exampleImage, [box]);
  useEditorStore.getState().select(box.id);
  const { result } = renderHook(() => useEditorActions(PROJECT_ID, new History()), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    ),
  });
  return { actions: result.current.actions, requests };
}

describe("rotateSelected", () => {
  beforeEach(() => useEditorStore.getState().reset());

  it("clamps the result, so nudging an overhanging box back to 0 is not refused", async () => {
    // The image is 4000 wide; this box's right edge is at 4020. That is legal at 1 degree (only
    // the centre has to be inside) and illegal at 0, where the server wants the box fully inside.
    const overhanging = { ...personBox, x: 3880, y: 300, w: 140, h: 90, angle: 1 };
    const { actions, requests } = mount(overhanging);

    await actions.rotateSelected(-1);

    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.body).toMatchObject({ angle: 0, x: 4000 - 140, y: 300, w: 140, h: 90 });
  });

  it("leaves a box that is already inside the image where it is", async () => {
    const { actions, requests } = mount({ ...personBox, angle: 0 });

    await actions.rotateSelected(5);

    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.body).toMatchObject({ angle: 5, x: personBox.x, y: personBox.y });
  });
});
