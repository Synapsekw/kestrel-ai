import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { errorBody, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { JobsButton } from "./JobsButton";
import { JobsPanel } from "./JobsPanel";

describe("JobsPanel", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("opens from the button, loads the job list newest first and closes", async () => {
    const older = {
      ...runningJob,
      id: "j0",
      created_at: "2026-09-17T09:00:00Z",
      state: "succeeded" as const,
    };
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/jobs$/, body: { items: [runningJob, older], next_cursor: null } },
    ]);
    renderWithProviders(
      <>
        <JobsButton />
        <JobsPanel projectId={PROJECT_ID} />
      </>,
      { api },
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "0 active jobs" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "0 active jobs" }));
    const dialog = await screen.findByRole("dialog", { name: "Jobs" });
    await waitFor(() => expect(screen.getAllByTestId(/^job-/)).toHaveLength(2));
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/jobs?limit=100`);
    const ids = screen.getAllByTestId(/^job-/).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual([`job-${runningJob.id}`, "job-j0"]);
    expect(screen.getByRole("button", { name: "1 active job" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close jobs" }));
    expect(dialog).not.toBeInTheDocument();
  });

  it("takes focus when it opens and closes on Escape", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/jobs$/, body: { items: [runningJob], next_cursor: null } },
    ]);
    useJobsStore.setState({ panelOpen: true });
    renderWithProviders(<JobsPanel projectId={PROJECT_ID} />, { api });
    const dialog = await screen.findByRole("dialog", { name: "Jobs" });
    await waitFor(() => expect(dialog).toHaveFocus());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useJobsStore.getState().panelOpen).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the envelope message when the list fails", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/jobs$/, status: 500, body: errorBody("internal_error", "db locked") },
    ]);
    useJobsStore.setState({ panelOpen: true });
    renderWithProviders(<JobsPanel projectId={PROJECT_ID} />, { api });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("db locked"));
  });
});
