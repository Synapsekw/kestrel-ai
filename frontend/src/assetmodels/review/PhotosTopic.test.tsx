// src/assetmodels/review/PhotosTopic.test.tsx
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ModelViewerHandle } from "@/assetmodels/viewer/ModelViewer";
import { renderWithProviders } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { POSES_PAGE } from "@/api/assetReview";
import { PhotosTopic } from "./PhotosTopic";
import { usePhotosLayer } from "./usePhotosLayer";

const pose = (i: number, outcome = "finding", sequence = "Flight 1") => ({
  image_id: `img-${i}`,
  position: [i, 2, 3],
  target: [0, 0, 0],
  up: [0, 1, 0],
  hfov_deg: 70,
  vfov_deg: 52,
  source: "exif_gimbal",
  accuracy_m: 3,
  sequence,
  outcome,
  updated_at: "2026-10-03T00:00:00Z",
});

function fakeHandle() {
  return {
    setCameras: vi.fn(),
    setSelectedCamera: vi.fn(),
    viewFromPose: vi.fn(),
  } as unknown as ModelViewerHandle &
    Record<"setCameras" | "setSelectedCamera" | "viewFromPose", ReturnType<typeof vi.fn>>;
}

function Harness({ handle }: { handle: ModelViewerHandle }) {
  const viewer = useRef<ModelViewerHandle | null>(handle);
  const layer = usePhotosLayer(PROJECT_ID, "m1", viewer);
  const actions = {
    running: { pose: false, place: false, group: false },
    estimate: vi.fn(),
    compute: vi.fn(),
    regroup: vi.fn(),
  };
  return <PhotosTopic projectId={PROJECT_ID} layer={layer} actions={actions} />;
}

describe("PhotosTopic", () => {
  it("pages poses", async () => {
    const page1 = Array.from({ length: POSES_PAGE }, (_, i) => pose(i));
    const page2 = Array.from({ length: 500 }, (_, i) => pose(POSES_PAGE + i));
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/asset-models\/m1\/poses$/,
        body: (r) =>
          r.url.includes("after=c1") ? { items: page2, next: null } : { items: page1, next: "c1" },
      },
    ]);
    const handle = fakeHandle();
    renderWithProviders(<Harness handle={handle} />, { api });
    expect(await screen.findByText("2,500 photos")).toBeInTheDocument();
    const urls = requests.filter((r) => r.url.includes("/poses")).map((r) => r.url);
    expect(urls).toHaveLength(2); // two pages, never one request for everything
    expect(urls.every((u) => u.includes(`limit=${POSES_PAGE}`))).toBe(true);
    expect(urls[1]).toContain("after=c1");
    await waitFor(() => expect(handle.setCameras.mock.calls.at(-1)?.[0]).toHaveLength(2500));
    // R-P2: nothing is pushed while pages arrive; exactly one push once the last page is in
    const lens = handle.setCameras.mock.calls.map((c) => (c[0] as unknown[]).length);
    expect(lens.filter((l) => l !== 2500)).toEqual([]);
    expect(lens).toEqual([2500]);
  });

  it("filters the cameras and turns them off", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/poses$/,
        body: {
          items: [pose(1, "finding", "A"), pose(2, "none", "A"), pose(3, "uncertain", "B")],
          next: null,
        },
      },
    ]);
    const handle = fakeHandle();
    renderWithProviders(<Harness handle={handle} />, { api });
    expect(await screen.findByText("2 photos")).toBeInTheDocument(); // the context photo is left out
    fireEvent.click(screen.getByRole("switch", { name: /include context photos/i }));
    expect(await screen.findByText("3 photos")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/sequence/i), { target: { value: "B" } });
    expect(await screen.findByText("1 photo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: /show cameras/i }));
    await waitFor(() => expect(handle.setCameras.mock.calls.at(-1)?.[0]).toEqual([]));
  });

  it("starts a pose estimate from the empty state", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/poses$/, body: { items: [], next: null } }]);
    const handle = fakeHandle();
    const estimate = vi.fn();
    function WithActions() {
      const viewer = useRef<ModelViewerHandle | null>(handle);
      const layer = usePhotosLayer(PROJECT_ID, "m1", viewer);
      return (
        <PhotosTopic
          projectId={PROJECT_ID}
          layer={layer}
          actions={{
            running: { pose: false, place: false, group: false },
            estimate,
            compute: vi.fn(),
            regroup: vi.fn(),
          }}
        />
      );
    }
    renderWithProviders(<WithActions />, { api });
    fireEvent.click(await screen.findByRole("button", { name: /estimate poses/i }));
    expect(estimate).toHaveBeenCalled();
  });

  it("looks through a selected photo's pose and back", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/poses$/, body: { items: [pose(7)], next: null } }]);
    const handle = fakeHandle();
    const selectRef: { current: (id: string) => void } = { current: () => {} };
    function Selecting() {
      const viewer = useRef<ModelViewerHandle | null>(handle);
      const layer = usePhotosLayer(PROJECT_ID, "m1", viewer);
      useEffect(() => {
        selectRef.current = layer.select;
      });
      return (
        <PhotosTopic
          projectId={PROJECT_ID}
          layer={layer}
          actions={{
            running: { pose: false, place: false, group: false },
            estimate: vi.fn(),
            compute: vi.fn(),
            regroup: vi.fn(),
          }}
        />
      );
    }
    renderWithProviders(<Selecting />, { api });
    await screen.findByText("1 photo");
    act(() => selectRef.current("img-7"));
    fireEvent.click(await screen.findByRole("button", { name: /view from here/i }));
    expect(handle.viewFromPose.mock.calls.at(-1)?.[0]).toMatchObject({ imageId: "img-7" });
    fireEvent.click(screen.getByRole("button", { name: /back to the model view/i }));
    expect(handle.viewFromPose.mock.calls.at(-1)?.[0]).toBeNull();
    expect(screen.getByRole("link", { name: /open photo/i })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/images/img-7`,
    );
  });
});
