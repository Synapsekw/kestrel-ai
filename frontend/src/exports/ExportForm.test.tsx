import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { ExportForm } from "./ExportForm";

describe("ExportForm", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("shows the labeled-images line and defaults to CSV + HTML", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <ExportForm projectId={PROJECT_ID} labeledCount={42} boxCount={112} onStarted={() => {}} />,
      {
        api,
      },
    );
    expect(screen.getByText("Exports the accepted boxes of all 42 images (112 boxes).")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Tables for Excel/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Report \(HTML/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Labels in YOLO/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Labels in COCO/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Include proposals/ })).not.toBeChecked();
  });

  it("refuses to submit with no format chosen", () => {
    const { api } = fakeClient([]);
    renderWithProviders(<ExportForm projectId={PROJECT_ID} labeledCount={1} boxCount={1} />, { api });
    fireEvent.click(screen.getByRole("checkbox", { name: /Tables for Excel/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Report \(HTML/ }));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose at least one format.");
  });

  it("posts the chosen formats and include_unreviewed, and reports the started job", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/exports$/,
        status: 202,
        body: { job: { ...runningJob, type: "results_export" } },
      },
    ]);
    let started: string | null = null;
    renderWithProviders(
      <ExportForm
        projectId={PROJECT_ID}
        labeledCount={5}
        boxCount={9}
        onStarted={(job) => {
          started = job.id;
        }}
      />,
      { api },
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /Labels in YOLO/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Include proposals/ }));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await screen.findByRole("button", { name: "Export" }); // settles
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/exports`,
      body: { formats: ["csv", "yolo", "html"], include_unreviewed: true },
    });
    expect(started).toBe(runningJob.id);
  });
});
