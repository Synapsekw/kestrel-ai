import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { fakeClient, runningJob } from "@/test/fixtures";
import { CLOUD_ID, PROJECT_ID, exampleSurface } from "@/test/volumeFixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import type { PointCloudOut } from "@/api/surfaces";
import { BuildSurfaceDialog } from "./BuildSurfaceDialog";

const cloud = { id: CLOUD_ID, name: "Chimney", status: "ready", crs_wkt: "PROJCS[...]" } as PointCloudOut;

describe("BuildSurfaceDialog", () => {
  it("builds with the defaults and sends only the cloud, name and method", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/surfaces$/,
        status: 202,
        body: { surface: exampleSurface, job: { ...runningJob, type: "surface_build" } },
      },
    ]);
    const onStarted = vi.fn();
    renderWithProviders(
      <BuildSurfaceDialog projectId={PROJECT_ID} clouds={[cloud]} onClose={() => {}} onStarted={onStarted} />,
      { api },
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Chimney surface");
    expect(screen.getByText(/Within 0.1–0.4 %/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(requests[0].body).toEqual({ point_cloud_id: CLOUD_ID, name: "Chimney surface", method: "median" });
    expect(useJobsStore.getState().jobs[runningJob.id]?.type).toBe("surface_build");
  });

  it("states the bias of the highest point and sends an explicit cell", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/surfaces$/,
        status: 202,
        body: { surface: exampleSurface, job: runningJob },
      },
    ]);
    renderWithProviders(
      <BuildSurfaceDialog projectId={PROJECT_ID} clouds={[cloud]} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    fireEvent.click(screen.getByRole("radio", { name: "Highest" }));
    expect(screen.getByText(/overstates stockpiles by 2–7 %/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Cell size"), { target: { value: "0.1" } });
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toMatchObject({ method: "max", cell_size_m: 0.1 });
  });

  it("offers Assume metres only for a cloud without coordinates", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <BuildSurfaceDialog
        projectId={PROJECT_ID}
        clouds={[{ ...cloud, crs_wkt: null }]}
        onClose={() => {}}
        onStarted={() => {}}
      />,
      { api },
    );
    fireEvent.click(screen.getByText("Advanced"));
    expect(screen.getByLabelText(/Assume metres/)).toBeInTheDocument();
  });

  it("shows the server's refusal inline", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/surfaces$/,
        status: 422,
        body: {
          error: {
            code: "insufficient_disk",
            message: "building this surface needs 2.1 GB free",
            details: {},
          },
        },
      },
    ]);
    renderWithProviders(
      <BuildSurfaceDialog projectId={PROJECT_ID} clouds={[cloud]} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("needs 2.1 GB free");
  });
});
