import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { createApiClient } from "@contract/client";
import {
  errorBody,
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

const RUN_JOB_ID = exampleQueryRun.job_id as string;

describe("RunCard", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("shows the run, its job, the box count, the review link and promotes", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/query-runs\/[^/]+$/, body: exampleQueryRun },
      {
        method: "GET",
        path: /\/jobs\/[^/]+$/,
        body: { ...runningJob, id: RUN_JOB_ID, type: "infer" },
      },
      {
        method: "POST",
        path: /\/promote$/,
        body: (req) =>
          (req.body as { dry_run?: boolean }).dry_run
            ? { query_run: exampleQueryRun, accepted: 6 }
            : { query_run: { ...exampleQueryRun, promoted_at: "2026-09-17T13:30:00Z" }, accepted: 6 },
      },
      {
        method: "POST",
        path: /\/unpromote$/,
        body: { query_run: exampleQueryRun, reverted: 6 },
      },
    ]);
    renderWithProviders(<RunCard projectId={PROJECT_ID} runId={RUN_ID} />, { api });
    const card = await screen.findByTestId("run-card");
    expect(card).toHaveTextContent('Anthropic: "dump trucks"');
    expect(screen.getByTestId("box-count")).toHaveTextContent("7 boxes written so far");
    await waitFor(() => expect(screen.getByTestId(`job-${RUN_JOB_ID}`)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Review results" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/review?ids=${IMAGE_ID},${IMAGE_ID_2}`,
    );
    expect(screen.getByLabelText("Minimum confidence")).toHaveValue(0.5);
    fireEvent.change(screen.getByLabelText("Minimum confidence"), { target: { value: "0.6" } });
    // Step 1 only counts: nothing is accepted until the operator confirms the number.
    fireEvent.click(screen.getByRole("button", { name: "Accept as labels…" }));
    const confirm = await screen.findByRole("button", { name: "Accept 6 boxes" });
    expect(screen.getByTestId("promote-confirm")).toHaveTextContent(
      "6 unreviewed boxes at or above 0.6 will become ground-truth labels",
    );
    expect(requests.filter((r) => r.url.endsWith("/promote")).map((r) => r.body)).toEqual([
      { min_confidence: 0.6, dry_run: true },
    ]);
    expect(screen.queryByText("Accepted as labels")).not.toBeInTheDocument();
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("6 boxes accepted"));
    expect(requests.filter((r) => r.url.endsWith("/promote"))[1]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/query-runs/${RUN_ID}/promote`,
      body: { min_confidence: 0.6 },
    });
    expect(screen.getByText("Accepted as labels")).toBeInTheDocument();
    // The acceptance can be undone from the same card.
    fireEvent.click(screen.getByRole("button", { name: "Undo acceptance" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("6 boxes returned to unreviewed"),
    );
    expect(screen.queryByText("Accepted as labels")).not.toBeInTheDocument();
    // A running job offers no resume.
    expect(screen.queryByRole("button", { name: "Resume run" })).not.toBeInTheDocument();
  });

  it("keeps the loaded card visible when a later poll fails", async () => {
    // The run is re-polled every 2 s while its job is active: the first answer loads, the rest fail.
    // A custom fetch is needed because a fake route's status is fixed.
    let runCalls = 0;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const fetchImpl: typeof fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const { pathname } = new URL(req.url);
      if (pathname.endsWith(`/jobs/${RUN_JOB_ID}`)) {
        return json({ ...runningJob, id: RUN_JOB_ID, type: "infer" });
      }
      runCalls += 1;
      return runCalls === 1 ? json(exampleQueryRun) : json(errorBody("internal_error", "db locked"), 500);
    };
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl });
    renderWithProviders(<RunCard projectId={PROJECT_ID} runId={RUN_ID} />, { api });
    const card = await screen.findByTestId("run-card");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("db locked"), {
      timeout: 5000,
    });
    expect(card).toBeInTheDocument();
    expect(screen.getByTestId("box-count")).toHaveTextContent("7 boxes written so far");
  }, 10000);

  it("offers Resume for an interrupted job and posts to the resume endpoint", async () => {
    const failedJob = {
      ...runningJob,
      id: RUN_JOB_ID,
      type: "infer" as const,
      state: "failed" as const,
      error: "provider timed out",
    };
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/query-runs\/[^/]+$/, body: exampleQueryRun },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: failedJob },
      {
        method: "POST",
        path: /\/resume$/,
        status: 202,
        body: { job: { ...runningJob, id: "j-resumed", type: "infer" } },
      },
    ]);
    useJobsStore.getState().upsert(failedJob);
    renderWithProviders(<RunCard projectId={PROJECT_ID} runId={RUN_ID} />, { api });
    fireEvent.click(await screen.findByRole("button", { name: "Resume run" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Resumed (job j-resume)"));
    expect(requests.find((r) => r.method === "POST")).toMatchObject({
      url: `/api/v1/projects/${PROJECT_ID}/query-runs/${RUN_ID}/resume`,
    });
    expect(useJobsStore.getState().jobs["j-resumed"]).toBeDefined();
  });

  it("shows the 409 envelope when the run's job is still going", async () => {
    const cancelledJob = {
      ...runningJob,
      id: RUN_JOB_ID,
      type: "infer" as const,
      state: "cancelled" as const,
    };
    const { api } = fakeClient([
      { method: "GET", path: /\/query-runs\/[^/]+$/, body: exampleQueryRun },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: cancelledJob },
      {
        method: "POST",
        path: /\/resume$/,
        status: 409,
        body: errorBody("conflict", "the run's job is still running"),
      },
    ]);
    useJobsStore.getState().upsert(cancelledJob);
    renderWithProviders(<RunCard projectId={PROJECT_ID} runId={RUN_ID} />, { api });
    fireEvent.click(await screen.findByRole("button", { name: "Resume run" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("the run's job is still running"),
    );
    expect(screen.getByTestId("run-card")).toBeInTheDocument();
  });

  it("says so when nothing would be accepted and lets the operator cancel a count", async () => {
    let wouldAccept = 0;
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/query-runs\/[^/]+$/, body: exampleQueryRun },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: { ...runningJob, id: RUN_JOB_ID, type: "infer" } },
      {
        method: "POST",
        path: /\/promote$/,
        body: () => ({ query_run: exampleQueryRun, accepted: wouldAccept }),
      },
    ]);
    renderWithProviders(<RunCard projectId={PROJECT_ID} runId={RUN_ID} />, { api });
    await screen.findByTestId("run-card");
    fireEvent.click(screen.getByRole("button", { name: "Accept as labels…" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "No unreviewed boxes at or above 0.5. Lower the minimum confidence or review the images one by one.",
      ),
    );
    expect(screen.queryByTestId("promote-confirm")).not.toBeInTheDocument();
    wouldAccept = 3;
    fireEvent.click(screen.getByRole("button", { name: "Accept as labels…" }));
    await screen.findByRole("button", { name: "Accept 3 boxes" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("promote-confirm")).not.toBeInTheDocument();
    expect(
      requests
        .filter((r) => r.url.endsWith("/promote"))
        .every((r) => (r.body as { dry_run: boolean }).dry_run),
    ).toBe(true);
  });
});
