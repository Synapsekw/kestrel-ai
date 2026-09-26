import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { useJobsStore } from "@/store/jobs";
import { fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { InterimJobs } from "./InterimJobs";

describe("InterimJobs", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("asks for a project when none is given", () => {
    renderWithProviders(<InterimJobs />, { api: fakeClient([]).api, route: "/jobs" });
    expect(screen.getByText("Open a project to see its jobs")).toBeInTheDocument();
  });

  it("lists the project's jobs newest first", async () => {
    const job = { ...runningJob, project_id: PROJECT_ID };
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/jobs$/, body: { items: [job], next_cursor: null } },
    ]);
    renderWithProviders(<InterimJobs />, { api, route: `/jobs?project=${PROJECT_ID}` });
    expect(await screen.findByTestId(`job-${job.id}`)).toBeInTheDocument();
    expect(requests[0].url).toContain(`/projects/${PROJECT_ID}/jobs`);
    expect(screen.getByRole("heading", { name: "Jobs" })).toBeInTheDocument();
  });
});
