import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ImageDetail } from "@/api/images";
import { exampleCloud } from "@/test/cloudFixtures";
import { exampleImage, fakeClient, IMAGE_ID, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ImagePanel } from "./ImagePanel";

const camera = {
  rel_alt: 38.4,
  gimbal_pitch: -90,
  gimbal_yaw: 12,
  focal_mm: 12.3,
  focal_px: 2956,
  sensor_w_mm: 17.3,
  lrf_distance_m: null,
  subject_distance_m: null,
  distance_m: 38.4,
  distance_sigma_m: 1,
  distance_source: "rel_alt",
  gsd_mm: 1.8,
  camera_model: "M3E",
};
const detail = {
  ...exampleImage,
  lat: 28.703,
  lon: 48.375,
  camera,
  footprint: null,
  footprint_kind: "trapezoid",
} as unknown as ImageDetail;

function setup(routes = [] as Parameters<typeof fakeClient>[0]) {
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/pointclouds$/, body: { items: [exampleCloud] } },
    ...routes,
  ]);
  const onDetail = vi.fn();
  renderWithProviders(
    <ImagePanel projectId={PROJECT_ID} detail={detail} onDetail={onDetail} distanceRef={createRef()} />,
    { api },
  );
  return { requests, onDetail };
}

describe("ImagePanel", () => {
  it("shows camera facts, the GSD and the distance source", () => {
    setup();
    expect(screen.getByText("1.8 mm/px")).toBeInTheDocument();
    expect(screen.getByText(/38\.4 m · nadir approx\. · ±1\.0 m/)).toBeInTheDocument();
    expect(screen.getByText("28.70300, 48.37500")).toBeInTheDocument();
  });

  it("sets and clears the subject distance", async () => {
    const { requests, onDetail } = setup([
      {
        method: "PATCH",
        path: new RegExp(`/images/${IMAGE_ID}$`),
        body: (r) => ({
          ...detail,
          camera: {
            ...camera,
            subject_distance_m: (r.body as { subject_distance_m: number | null }).subject_distance_m,
          },
        }),
      },
    ]);
    const field = screen.getByLabelText("Subject distance (m)");
    await userEvent.type(field, "12.5{Enter}");
    await waitFor(() => expect(onDetail).toHaveBeenCalled());
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ subject_distance_m: 12.5 });
  });

  it("refuses a distance out of range without a request", async () => {
    const { requests } = setup();
    await userEvent.type(screen.getByLabelText("Subject distance (m)"), "0{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("between 0.1 and 10,000 m");
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("offers Open in 3D for a cloud that covers the frame", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Image actions" }));
    expect(screen.getByRole("menuitem", { name: /Open in 3D · Chimney stack 3D/ })).toBeInTheDocument();
  });
});
