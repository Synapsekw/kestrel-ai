import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { Job } from "@contract/client";
import { fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { ExportForm } from "./ExportForm";

interface FormProps {
  labeledCount: number | null;
  boxCount: number | null;
  imageCount: number | null;
  pendingReviewCount: number | null;
  onStarted?: (job: Job) => void;
}

function renderForm(props: Partial<FormProps> = {}) {
  const { api, requests } = fakeClient([
    {
      method: "POST",
      path: /\/exports$/,
      status: 202,
      body: { job: { ...runningJob, type: "results_export" } },
    },
  ]);
  renderWithProviders(
    <ExportForm
      projectId={PROJECT_ID}
      labeledCount={5}
      boxCount={9}
      imageCount={10}
      pendingReviewCount={3}
      {...props}
    />,
    { api },
  );
  return { api, requests };
}

describe("ExportForm", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("shows the export summary and defaults to CSV + HTML", () => {
    renderForm();
    expect(screen.getByText("Exports 9 accepted boxes on 5 of 10 images.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Tables for Excel/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Report \(HTML/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Labels in YOLO/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Labels in COCO/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Include proposals/ })).not.toBeChecked();
  });

  it("adds the unreviewed-proposals clause to the summary once the checkbox is ticked", () => {
    renderForm();
    fireEvent.click(screen.getByRole("checkbox", { name: /Include proposals/ }));
    expect(
      screen.getByText("Exports 9 accepted boxes on 5 of 10 images and 3 unreviewed proposals."),
    ).toBeInTheDocument();
  });

  it("labels the checkbox with what each format can and cannot mark", () => {
    renderForm();
    expect(
      screen.getByText(/the tables, COCO and the report mark them; YOLO label files cannot/),
    ).toBeInTheDocument();
  });

  it("refuses to submit with no format chosen", () => {
    renderForm();
    fireEvent.click(screen.getByRole("checkbox", { name: /Tables for Excel/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Report \(HTML/ }));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose at least one format.");
  });

  it("posts the chosen formats and include_unreviewed, and reports the started job", async () => {
    let started: string | null = null;
    const { requests } = renderForm({
      onStarted: (job) => {
        started = job.id;
      },
    });
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
