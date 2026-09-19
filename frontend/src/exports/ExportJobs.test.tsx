import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ExportJobs } from "./ExportJobs";

const succeeded = {
  ...runningJob,
  id: "j-done",
  type: "results_export" as const,
  state: "succeeded" as const,
  progress: 1,
  result: {
    folder: "exports/2026-09-19_101500",
    files: ["detections.csv", "report.html"],
    image_count: 12,
    box_count: 30,
  },
};

describe("ExportJobs", () => {
  it("shows the empty state", () => {
    const { api } = fakeClient([]);
    renderWithProviders(<ExportJobs projectId={PROJECT_ID} jobs={[]} />, { api });
    expect(screen.getByText("No exports yet.")).toBeInTheDocument();
  });

  it("renders a finished export's summary and files, and reveals its folder", async () => {
    const { api, requests } = fakeClient([{ method: "POST", path: /\/reveal$/, status: 204 }]);
    renderWithProviders(<ExportJobs projectId={PROJECT_ID} jobs={[succeeded]} />, { api });
    const row = screen.getByTestId(`export-job-${succeeded.id}`);
    expect(row).toHaveTextContent("12 images, 30 boxes");
    expect(row).toHaveTextContent("detections.csv");
    expect(row).toHaveTextContent("report.html");
    fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
    await screen.findByRole("button", { name: "Show in folder" });
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/reveal`,
      body: { path: "exports/2026-09-19_101500" },
    });
  });

  it("shows a running export as a job card instead of the summary row", () => {
    const running = { ...runningJob, type: "results_export" as const, state: "running" as const };
    const { api } = fakeClient([]);
    renderWithProviders(<ExportJobs projectId={PROJECT_ID} jobs={[running]} />, { api });
    expect(screen.getByTestId(`job-${running.id}`)).toBeInTheDocument();
  });

  it("surfaces a reveal failure as an alert", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/reveal$/,
        status: 404,
        body: { error: { code: "not_found", message: "the export folder is gone", details: {} } },
      },
    ]);
    renderWithProviders(<ExportJobs projectId={PROJECT_ID} jobs={[succeeded]} />, { api });
    fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("the export folder is gone");
  });
});
