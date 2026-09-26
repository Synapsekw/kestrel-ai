import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { exampleCloud } from "@/test/cloudFixtures";
import { renderWithProviders } from "@/test/render";
import { ImportCloudDialog } from "./ImportCloudDialog";

const info = (ok: boolean) => ({
  path: "D:\\clouds\\site.las",
  size: 737_902_645,
  compressed: false,
  las_version: "1.2",
  point_format: 3,
  point_count: 21_697_184,
  has_rgb: true,
  header_bounds: [0, 0, 0, 1, 1, 1],
  crs_wkt: "x",
  epsg: 32639,
  captured_on: "2026-05-04",
  admission: {
    ok,
    ram_needed_bytes: 2_050_000_000,
    ram_available_bytes: ok ? 30e9 : 1e9,
    disk_needed_bytes: 1,
    disk_available_bytes: 2,
    reason: ok
      ? null
      : "This cloud needs about 2.1 GB of free memory; 1.0 GB is free. Close other programs and try again.",
  },
});

describe("import dialog", () => {
  it("shows the refusal verbatim and disables Import", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/maps$/, body: { items: [] } },
      { method: "POST", path: /\/pointclouds\/inspect$/, body: info(false) },
    ]);
    renderWithProviders(<ImportCloudDialog projectId={PROJECT_ID} onClose={vi.fn()} onStarted={vi.fn()} />, {
      api,
    });
    await userEvent.type(screen.getByLabelText("LAS or LAZ file"), "D:\\clouds\\site.las");
    expect(await screen.findByText(/needs about 2.1 GB of free memory; 1.0 GB is free/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("imports an admissible file with its name", async () => {
    const onStarted = vi.fn();
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/maps$/, body: { items: [] } },
      { method: "POST", path: /\/pointclouds\/inspect$/, body: info(true) },
      {
        method: "POST",
        path: /\/pointclouds$/,
        status: 202,
        body: { cloud: { ...exampleCloud, status: "importing" }, job: runningJob },
      },
    ]);
    renderWithProviders(
      <ImportCloudDialog projectId={PROJECT_ID} onClose={vi.fn()} onStarted={onStarted} />,
      { api },
    );
    await userEvent.type(screen.getByLabelText("LAS or LAZ file"), "D:\\clouds\\site.las");
    expect(await screen.findByText("21.7 M points")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Name"), "Chimney");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const post = requests.find((r) => r.method === "POST" && /\/pointclouds$/.test(r.url));
    expect(post?.body).toEqual({ path: "D:\\clouds\\site.las", name: "Chimney" });
  });
});
