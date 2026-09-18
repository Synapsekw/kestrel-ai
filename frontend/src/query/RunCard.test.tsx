import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  exampleQueryRun,
  fakeClient,
  IMAGE_ID,
  IMAGE_ID_2,
  PROJECT_ID,
  RUN_ID,
  runningJob,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { RunCard } from "./RunCard";

describe("RunCard", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("shows the run, its job, the box count, the review link and promotes", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/query-runs\/[^/]+$/, body: exampleQueryRun },
      {
        method: "GET",
        path: /\/jobs\/[^/]+$/,
        body: { ...runningJob, id: exampleQueryRun.job_id as string, type: "infer" },
      },
      {
        method: "POST",
        path: /\/promote$/,
        body: { query_run: { ...exampleQueryRun, promoted_at: "2026-09-17T13:30:00Z" }, accepted: 6 },
      },
    ]);
    renderWithProviders(<RunCard projectId={PROJECT_ID} runId={RUN_ID} />, { api });
    const card = await screen.findByTestId("run-card");
    expect(card).toHaveTextContent('Anthropic: "dump trucks"');
    expect(screen.getByTestId("box-count")).toHaveTextContent("7 boxes written so far");
    await waitFor(() => expect(screen.getByTestId(`job-${exampleQueryRun.job_id}`)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Review results" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/review?ids=${IMAGE_ID},${IMAGE_ID_2}`,
    );
    expect(screen.getByLabelText("Minimum confidence")).toHaveValue(0.5);
    fireEvent.change(screen.getByLabelText("Minimum confidence"), { target: { value: "0.6" } });
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("6 boxes accepted"));
    expect(requests.find((r) => r.url.endsWith("/promote"))).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/query-runs/${RUN_ID}/promote`,
      body: { min_confidence: 0.6 },
    });
    expect(screen.getByText("Promoted")).toBeInTheDocument();
  });
});
