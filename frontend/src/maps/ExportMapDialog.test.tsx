import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { exampleGeoMap, exampleMapRun, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { ExportMapDialog } from "./ExportMapDialog";

describe("ExportMapDialog", () => {
  it("exports a scored run in every format", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/map-exports$/,
        status: 202,
        body: { job: { ...runningJob, type: "map_export" } },
      },
    ]);
    renderWithProviders(
      <ExportMapDialog
        projectId={PROJECT_ID}
        geoMap={exampleGeoMap}
        runs={[exampleMapRun]}
        selectedRunId={exampleMapRun.id}
        onClose={() => {}}
      />,
      { api },
    );
    fireEvent.click(screen.getByRole("radio", { name: "Run scored against labels" }));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toEqual({
      map_id: exampleGeoMap.id,
      content: "run_score",
      run_id: exampleMapRun.id,
      formats: ["geojson", "gpkg", "csv"],
    });
    expect(useJobsStore.getState().jobs[runningJob.id]?.type).toBe("map_export");
  });

  it("offers only the pixel CSV for a map without coordinates", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <ExportMapDialog
        projectId={PROJECT_ID}
        geoMap={{ ...exampleGeoMap, crs_wkt: null }}
        runs={[]}
        selectedRunId={null}
        onClose={() => {}}
      />,
      { api },
    );
    expect(screen.getByRole("checkbox", { name: /GeoJSON/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /CSV/ })).toBeChecked();
    expect(screen.getByText(/no coordinates/i)).toBeInTheDocument();
  });
});
