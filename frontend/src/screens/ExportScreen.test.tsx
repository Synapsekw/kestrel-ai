import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { exampleStats, exampleTrainedModel, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { ExportScreen } from "./ExportScreen";

function renderScreen(routes: Parameters<typeof fakeClient>[0]) {
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/stats$/, body: exampleStats },
    { method: "GET", path: /\/models$/, body: { items: [exampleTrainedModel], next_cursor: null } },
    { method: "GET", path: /\/jobs$/, body: { items: [], next_cursor: null } },
    ...routes,
  ]);
  renderWithProviders(<ExportScreen />, {
    api,
    route: `/p/${PROJECT_ID}/export`,
    path: "/p/:projectId/export",
  });
  return { api, requests };
}

describe("ExportScreen", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("shows the Export heading, the results form and the model export section", async () => {
    renderScreen([]);
    expect(screen.getByRole("heading", { name: "Export" })).toBeInTheDocument();
    expect(await screen.findByText(/Exports the accepted boxes of all/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Past exports" })).toBeInTheDocument();
    expect(screen.getByText("No exports yet.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Model for other applications" })).toBeInTheDocument();
  });

  it("starts an export from the form and it appears under Past exports (via the shared jobs store)", async () => {
    const succeeded = {
      ...runningJob,
      type: "results_export" as const,
      state: "succeeded" as const,
      result: {
        folder: "exports/2026-09-19_101500",
        files: ["detections.csv"],
        image_count: 2,
        box_count: 3,
      },
    };
    renderScreen([{ method: "POST", path: /\/exports$/, status: 202, body: { job: succeeded } }]);
    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    expect(await screen.findByTestId(`export-job-${succeeded.id}`)).toHaveTextContent("2 images, 3 boxes");
  });
});
