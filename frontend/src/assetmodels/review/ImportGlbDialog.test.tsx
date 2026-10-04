// src/assetmodels/review/ImportGlbDialog.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { ImportGlbDialog } from "./ImportGlbDialog";

describe("ImportGlbDialog", () => {
  it("imports a GLB with a frame conversion and an origin", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/versions\/import-glb$/,
        status: 202,
        body: { version: { version: 3 }, job: { id: "j9", type: "asset_glb_import", state: "queued" } },
      },
    ]);
    const onStarted = vi.fn();
    renderWithProviders(
      <ImportGlbDialog projectId={PROJECT_ID} modelId="m1" onClose={() => {}} onStarted={onStarted} />,
      { api },
    );
    fireEvent.change(screen.getByLabelText(/glb file/i), { target: { value: "D:\\models\\tower.glb" } });
    fireEvent.change(screen.getByLabelText(/axes in the file/i), {
      target: { value: "x_east_minus_z_north" },
    });
    fireEvent.change(screen.getByLabelText(/latitude/i), { target: { value: "25.2" } });
    fireEvent.change(screen.getByLabelText(/longitude/i), { target: { value: "55.3" } });
    fireEvent.change(screen.getByLabelText(/ground altitude/i), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(3, "j9"));
    expect(requests[0].body).toEqual({
      path: "D:\\models\\tower.glb",
      frame_conversion: "x_east_minus_z_north",
      origin: { lat: 25.2, lon: 55.3, ground_alt_m: 4 },
    });
  });

  it("needs all three origin fields or none", async () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <ImportGlbDialog projectId={PROJECT_ID} modelId="m1" onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    fireEvent.change(screen.getByLabelText(/glb file/i), { target: { value: "D:\\a.glb" } });
    fireEvent.change(screen.getByLabelText(/latitude/i), { target: { value: "25.2" } });
    expect(screen.getByRole("button", { name: /^import$/i })).toBeDisabled();
    expect(screen.getByText(/latitude, longitude and ground altitude together/i)).toBeInTheDocument();
  });
});
