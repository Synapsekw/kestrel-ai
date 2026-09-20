import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { Job } from "@contract/client";
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

function render(jobs: Job[], opts: { loading?: boolean; error?: string | null } = {}) {
  const { api, requests } = fakeClient([{ method: "POST", path: /\/reveal$/, status: 204 }]);
  renderWithProviders(
    <ExportJobs
      projectId={PROJECT_ID}
      jobs={jobs}
      loading={opts.loading ?? false}
      error={opts.error ?? null}
    />,
    { api },
  );
  return { api, requests };
}

describe("ExportJobs", () => {
  it("shows Loading… while the list is loading", () => {
    render([], { loading: true });
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("No exports yet.")).not.toBeInTheDocument();
  });

  it("shows the load error instead of the empty state", () => {
    render([], { error: "could not load past exports" });
    expect(screen.getByRole("alert")).toHaveTextContent("could not load past exports");
    expect(screen.queryByText("No exports yet.")).not.toBeInTheDocument();
  });

  it("shows the empty state once loaded with nothing", () => {
    render([]);
    expect(screen.getByText("No exports yet.")).toBeInTheDocument();
  });

  it("renders a finished export's summary and files, and reveals its folder", async () => {
    const { requests } = render([succeeded]);
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

  it("truncates a long file list to 8 names plus 'and N more'", () => {
    const many = {
      ...succeeded,
      result: { ...succeeded.result, files: Array.from({ length: 11 }, (_, i) => `file${i}.txt`) },
    };
    render([many]);
    const row = screen.getByTestId(`export-job-${many.id}`);
    for (let i = 0; i < 8; i++) expect(row).toHaveTextContent(`file${i}.txt`);
    expect(row).not.toHaveTextContent("file8.txt");
    expect(row).toHaveTextContent("and 3 more");
  });

  it("shows a running export as a job card instead of the summary row", () => {
    const running = { ...runningJob, type: "results_export" as const, state: "running" as const };
    render([running]);
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
    renderWithProviders(
      <ExportJobs projectId={PROJECT_ID} jobs={[succeeded]} loading={false} error={null} />,
      { api },
    );
    fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("the export folder is gone");
  });
});
