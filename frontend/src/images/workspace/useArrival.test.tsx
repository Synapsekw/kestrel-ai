import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate, useParams } from "react-router-dom";
import type { Box } from "@contract/client";
import { ANNOTATION_ID, exampleFinding, FINDING_ID } from "@/test/findingFixtures";
import { fakeClient, IMAGE_ID, IMAGE_ID_2, PROJECT_ID, personBox } from "@/test/fixtures";
import { LocationProbe, TestApiProvider } from "@/test/render";
import { ArrivalProbe, BackTo3DChip } from "./ArrivalMarker";
import { useArrivalStore } from "./arrivalStore";
import { useArrival } from "./useArrival";

const fake = {
  centreOn: vi.fn(),
  panIntoView: vi.fn(),
  select: vi.fn(),
  boxes: {
    [ANNOTATION_ID]: { ...personBox, id: ANNOTATION_ID, x: 3000, y: 2000, w: 100, h: 100 } as Box,
  } as Record<string, Box>,
};
// The brief's mock replaced the whole module; panTo.ts's shapeBounds also needs seams' geometry
// helpers (aabbOf, orientedRectOf, ...) for a non-point/polygon box, so this keeps them real.
vi.mock("./seams", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./seams")>()),
  useImagesWorkspace: { getState: () => ({ centreOn: fake.centreOn, panIntoView: fake.panIntoView }) },
  useSelection: () => ({ selectedId: null, select: fake.select, boxes: fake.boxes, boxesLoaded: true }),
}));
vi.mock("@/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui")>()),
  useReducedMotion: () => true,
}));

let go: (to: string) => void = () => {};
/** Captures the router's navigate so a test can move to the next image. */
function Nav() {
  const navigate = useNavigate();
  useEffect(() => {
    go = (to) => void navigate(to);
  });
  return null;
}
function Page({ onOpen }: { onOpen: () => void }) {
  const { imageId = "" } = useParams();
  useArrival({
    projectId: PROJECT_ID,
    imageId,
    width: 4000,
    height: 2667,
    ready: true,
    onOpenInspector: onOpen,
  });
  return (
    <>
      <ArrivalProbe imageId={imageId} />
      <BackTo3DChip projectId={PROJECT_ID} imageId={imageId} />
    </>
  );
}

function mount(url: string, routes: Parameters<typeof fakeClient>[0] = []) {
  const { api } = fakeClient(routes);
  const onOpen = vi.fn();
  render(
    <TestApiProvider api={api}>
      <MemoryRouter initialEntries={[url]}>
        <Nav />
        <Routes>
          <Route path="/p/:projectId/images/:imageId" element={<Page onOpen={onOpen} />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </TestApiProvider>,
  );
  return { onOpen };
}

const loc = () => screen.getByTestId("location").textContent;

beforeEach(() => {
  fake.centreOn.mockClear();
  fake.panIntoView.mockClear();
  fake.select.mockClear();
  useArrivalStore.setState({ imageId: null, marker: null, cloudId: null });
});

describe("useArrival (§6.5)", () => {
  it("?at=&r=&from=cloud: centres, draws the static ring, offers Back to 3D and drops the params", async () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}?keep=1&at=2000,1300&r=40&from=cloud:c1`);
    await waitFor(() => expect(loc()).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID}?keep=1`));
    expect(fake.centreOn).toHaveBeenCalledWith({ x: 2000, y: 1300 }, { radiusPx: 40, animate: false });
    expect(useArrivalStore.getState()).toMatchObject({
      imageId: IMAGE_ID,
      marker: { px: 2000, py: 1300, r: 40 },
      cloudId: "c1",
    });
  });

  it("ignores a malformed at and still drops it", async () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}?at=garbage&r=5`);
    await waitFor(() => expect(loc()).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID}`));
    expect(fake.centreOn).not.toHaveBeenCalled();
    expect(useArrivalStore.getState().marker).toBeNull();
  });

  it("ignores an at outside the frame", async () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}?at=5000,10&from=cloud:c1`);
    await waitFor(() => expect(loc()).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID}`));
    expect(useArrivalStore.getState().marker).toBeNull();
    expect(useArrivalStore.getState().cloudId).toBeNull();
  });

  it("the next image carries nothing", async () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}?at=10,10&from=cloud:c1`);
    await waitFor(() => expect(useArrivalStore.getState().marker).not.toBeNull());
    act(() => go(`/p/${PROJECT_ID}/images/${IMAGE_ID_2}`));
    await waitFor(() => expect(loc()).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID_2}`));
    expect(useArrivalStore.getState()).toMatchObject({ marker: null, cloudId: null });
  });

  it("?finding= selects the annotation, pans to it, opens the inspector and drops the param", async () => {
    const { onOpen } = mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}?finding=${FINDING_ID}`, [
      { method: "GET", path: new RegExp(`/findings/${FINDING_ID}$`), body: exampleFinding },
    ]);
    await waitFor(() => expect(fake.select).toHaveBeenCalledWith(ANNOTATION_ID));
    expect(onOpen).toHaveBeenCalled();
    expect(fake.panIntoView).toHaveBeenCalledWith({ x: 3000, y: 2000, w: 100, h: 100 }, { animate: false }); // reduced motion in this test
    await waitFor(() => expect(loc()).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID}`));
  });

  it("a finding on another image redirects there and is handled there", async () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID_2}?finding=${FINDING_ID}`, [
      { method: "GET", path: new RegExp(`/findings/${FINDING_ID}$`), body: exampleFinding },
    ]);
    // The redirect keeps ?finding=, and the finding's own image then consumes and drops it.
    await waitFor(() => expect(loc()).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID}`));
    expect(fake.select).toHaveBeenCalledWith(ANNOTATION_ID);
  });

  it("an unknown finding is dropped silently", async () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}?finding=${FINDING_ID}`);
    await waitFor(() => expect(loc()).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID}`));
    expect(fake.select).not.toHaveBeenCalled();
  });

  // Amendment (IMC reconciliation item 9): a back-only arrival (found a photo by distance, no
  // pixel) drops the params, never centres and never draws a ring, but still offers Back to 3D.
  it("?from=cloud: with no at leaves the URL without from, never centres, offers Back to 3D and draws no ring", async () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}?from=cloud:c1`);
    await waitFor(() => expect(loc()).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID}`));
    expect(fake.centreOn).not.toHaveBeenCalled();
    expect(useArrivalStore.getState()).toMatchObject({ imageId: IMAGE_ID, marker: null, cloudId: "c1" });
    expect(screen.getByRole("link", { name: "Back to 3D" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/clouds/c1`,
    );
    expect(screen.queryByTestId("arrival-marker")).toBeNull();
  });
});
