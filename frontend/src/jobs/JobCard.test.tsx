import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { exampleJobLog, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { JobCard } from "./JobCard";

describe("JobCard", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("shows progress and message, cancels through the api and toggles the log", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/cancel$/,
        body: { ...runningJob, state: "cancelled", finished_at: "2026-09-17T10:07:00Z" },
      },
      { method: "GET", path: /\/log$/, body: exampleJobLog },
    ]);
    useJobsStore.getState().upsert(runningJob);
    renderWithProviders(<JobCard projectId={PROJECT_ID} job={runningJob} />, { api });
    expect(screen.getByText("Import")).toBeInTheDocument();
    expect(screen.getByTestId("jobcard-state")).toHaveTextContent("Running");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText(/1386 \/ 3299 images/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show log" }));
    await waitFor(() => expect(screen.getByTestId("jobcard-log")).toHaveTextContent("job started"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel job" }));
    await waitFor(() => expect(useJobsStore.getState().jobs[runningJob.id].state).toBe("cancelled"));
    expect(requests.some((r) => r.method === "POST" && r.url.endsWith(`/jobs/${runningJob.id}/cancel`))).toBe(
      true,
    );
  });

  it("shows the error of a failed job and the result link of a succeeded one", () => {
    const { api } = fakeClient([]);
    const failed = {
      ...runningJob,
      type: "train" as const,
      state: "failed" as const,
      error: "CUDA out of memory",
    };
    const { unmount } = renderWithProviders(<JobCard projectId={PROJECT_ID} job={failed} />, { api });
    expect(screen.getByRole("alert")).toHaveTextContent("CUDA out of memory");
    expect(screen.queryByRole("button", { name: "Cancel job" })).not.toBeInTheDocument();
    unmount();
    const done = {
      ...runningJob,
      type: "train" as const,
      state: "succeeded" as const,
      progress: 1,
      result: { model_id: "m9" },
    };
    renderWithProviders(<JobCard projectId={PROJECT_ID} job={done} />, { api });
    expect(screen.getByRole("link", { name: "Open model" })).toHaveAttribute("href", "/library?model=m9");
  });
});
