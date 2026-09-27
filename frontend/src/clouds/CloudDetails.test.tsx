import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import type { PointCloud } from "@/api/clouds";
import { CloudDetails } from "./CloudDetails";

function details(cloud: PointCloud, routes: Parameters<typeof fakeClient>[0] = []) {
  const { api, requests } = fakeClient(routes);
  renderWithProviders(
    <CloudDetails
      projectId={PROJECT_ID}
      cloud={cloud}
      maps={[]}
      exportJobId={null}
      onExportStarted={vi.fn()}
      onChanged={vi.fn()}
      onDeleted={vi.fn()}
    />,
    { api },
  );
  return requests;
}

describe("CloudDetails", () => {
  it("states the repaired header and the missing vertical datum", () => {
    details(exampleCloud);
    expect(screen.getByText(/Header bounds repaired/)).toBeInTheDocument();
    expect(screen.getByText(/as stored, no vertical datum/)).toBeInTheDocument();
  });

  it("offers Assign CRS only when the cloud has no coordinates", () => {
    details({ ...exampleCloud, crs_wkt: null, epsg: null, proj4: null, bounds_wgs84: null });
    expect(screen.getByLabelText("EPSG code")).toBeInTheDocument();
  });

  it("saves the capture date when the field is left, not on every keystroke", async () => {
    const requests = details(exampleCloud, [
      {
        method: "PATCH",
        path: new RegExp(`/pointclouds/${CLOUD_ID}$`),
        body: { ...exampleCloud, captured_on: "2026-05-12" },
      },
    ]);
    const input = screen.getByLabelText("Captured on");
    for (const v of ["0002-05-12", "0020-05-12", "0202-05-12", "2026-05-12"])
      fireEvent.change(input, { target: { value: v } });
    expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
    fireEvent.blur(input);
    await waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(1));
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ captured_on: "2026-05-12" });
  });

  it("offers Export LAZ only for a ready cloud and keeps a link that no longer qualifies", () => {
    details({ ...exampleCloud, status: "failed", error: "boom", map_id: "m-gone" });
    expect(screen.getByRole("button", { name: "Export LAZ" })).toBeDisabled();
    expect(screen.getByLabelText("Linked map")).toHaveValue("m-gone");
  });
});
