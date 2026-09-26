import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { AppEvent } from "@contract/client";
import {
  exampleJobLog,
  exampleProject,
  fakeClient,
  JOB_ID,
  PROJECT_ID,
  runningJob,
  type FakeRoute,
} from "@/test/fixtures";
import { exampleAppJobs, LIB_JOB_ID } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { JobsScreen } from "./JobsScreen";

function jobsRoute(items = exampleAppJobs): FakeRoute {
  return {
    method: "GET",
    path: /\/api\/v1\/jobs$/,
    body: (r) => {
      const states = new URL(`http://x${r.url}`).searchParams.getAll("state");
      return {
        items: items.filter((j) => states.length === 0 || states.includes(j.state)),
        next_cursor: null,
      };
    },
  };
}

const PROJECTS: FakeRoute = {
  method: "GET",
  path: /\/api\/v1\/projects$/,
  body: { items: [exampleProject], next_cursor: null },
};
const LOG: FakeRoute = { method: "GET", path: /\/jobs\/[^/]+\/log$/, body: exampleJobLog };

function renderJobs(route = "/jobs", routes: FakeRoute[] = [jobsRoute(), PROJECTS, LOG]) {
  const { api, requests } = fakeClient(routes);
  renderWithProviders(<JobsScreen />, { api, route, path: "/jobs" });
  return requests;
}

describe("JobsScreen", () => {
  // The jobs store is module state: start every case from an empty store.
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("shows running jobs with their project, and counts running and queued", async () => {
    renderJobs();
    const row = await screen.findByRole("row", { name: /Import/ });
    expect(row).toHaveTextContent("Ahmadia");
    expect(row).toHaveTextContent("1386 / 3299 images");
    await waitFor(() => expect(screen.getByRole("radio", { name: "Running · 1" })).toBeChecked());
    expect(screen.getByRole("radio", { name: "Queued · 0" })).toBeInTheDocument();
  });

  it("Finished lists succeeded and cancelled jobs, library jobs included", async () => {
    const requests = renderJobs("/jobs?state=finished");
    expect(await screen.findByRole("row", { name: /Dataset build: machines-v1/ })).toHaveTextContent(
      "Model library",
    );
    expect(requests.some((r) => r.url.includes("state=succeeded&state=cancelled"))).toBe(true);
  });

  it("filters by project through the URL and the request", async () => {
    const requests = renderJobs("/jobs?project=library");
    await waitFor(() => expect(requests.some((r) => r.url.includes("project_id=library"))).toBe(true));
    expect(screen.getByLabelText("Project")).toHaveValue("library");
    await screen.findByRole("option", { name: "Ahmadia" });
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: PROJECT_ID } });
    await waitFor(() => expect(requests.some((r) => r.url.includes(`project_id=${PROJECT_ID}`))).toBe(true));
  });

  it("opens a row with its log and cancels through the project's route", async () => {
    const requests = renderJobs("/jobs", [
      jobsRoute(),
      PROJECTS,
      LOG,
      { method: "POST", path: /\/jobs\/[^/]+\/cancel$/, body: { ...runningJob, state: "cancelled" } },
    ]);
    fireEvent.click(await screen.findByRole("row", { name: /Import/ }));
    expect(await screen.findByTestId("jobcard-log")).toHaveTextContent("50 / 3299 images");
    fireEvent.click(screen.getByRole("button", { name: "Cancel job" }));
    await waitFor(() =>
      expect(requests.some((r) => r.url === `/api/v1/projects/${PROJECT_ID}/jobs/${JOB_ID}/cancel`)).toBe(
        true,
      ),
    );
  });

  it("cancels a library job through the library route", async () => {
    const libRunning = { ...exampleAppJobs[1], state: "running" as const, finished_at: null };
    const requests = renderJobs(`/jobs?job=${LIB_JOB_ID}`, [
      jobsRoute([libRunning]),
      PROJECTS,
      LOG,
      { method: "POST", path: /\/cancel$/, body: { ...libRunning, state: "cancelled" } },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel job" }));
    await waitFor(() =>
      expect(requests.some((r) => r.url === `/api/v1/library/jobs/${LIB_JOB_ID}/cancel`)).toBe(true),
    );
  });

  it("a job that finishes leaves the Running list and its open inspector offers the result", async () => {
    renderJobs(`/jobs?job=${JOB_ID}`);
    await screen.findByRole("row", { name: /Import/ });
    expect(await screen.findByRole("button", { name: "Cancel job" })).toBeInTheDocument();
    act(() =>
      useJobsStore.getState().applyEvent({
        type: "job.state",
        job_id: JOB_ID,
        payload: { state: "succeeded" },
      } as unknown as AppEvent),
    );
    expect(screen.queryByRole("row", { name: /Import/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open images" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel job" })).not.toBeInTheDocument();
  });

  it("an unknown ?job= says the job is not in the list", async () => {
    renderJobs("/jobs?job=nope");
    expect(await screen.findByText("This job is not in the list")).toBeInTheDocument();
  });
});
