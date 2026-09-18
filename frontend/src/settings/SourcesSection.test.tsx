import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  errorBody,
  exampleSource,
  exampleStats,
  fakeClient,
  PROJECT_ID,
  runningJob,
  SOURCE_ID,
} from "@/test/fixtures";
import { createApiClient } from "@contract/client";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { SourcesSection } from "./SourcesSection";

describe("SourcesSection", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("lists sources with counts, loads stats on demand and re-imports the same folder", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/sources$/, body: { items: [exampleSource], next_cursor: null } },
      { method: "GET", path: /\/sources\/[^/]+\/stats$/, body: exampleStats },
      { method: "POST", path: /\/sources$/, status: 202, body: { source: exampleSource, job: runningJob } },
    ]);
    renderWithProviders(<SourcesSection projectId={PROJECT_ID} />, { api });
    const section = await screen.findByTestId("sources-section");
    await waitFor(() => expect(section).toHaveTextContent("ahmadia"));
    expect(section).toHaveTextContent("3299 images");
    expect(section).toHaveTextContent("0 duplicates");
    fireEvent.click(screen.getByRole("button", { name: "Stats" }));
    await waitFor(() => expect(section).toHaveTextContent("3269 unlabeled"));
    expect(section).toHaveTextContent("41 pending review");
    expect(section).toHaveTextContent("2 groups");
    expect(requests[1].url).toBe(`/api/v1/projects/${PROJECT_ID}/sources/${SOURCE_ID}/stats`);
    fireEvent.click(screen.getByRole("button", { name: "Re-import new files" }));
    await waitFor(() => expect(useJobsStore.getState().panelOpen).toBe(true));
    expect(requests[2]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/sources`,
      body: { folder: exampleSource.folder, site: "ahmadia", settings: exampleSource.settings },
    });
    expect(useJobsStore.getState().jobs[runningJob.id]).toBeDefined();
  });

  it("re-lists only once the re-import job has finished, and drops the stale statistics", async () => {
    let sourceLists = 0;
    let jobPolls = 0;
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/sources$/,
        body: () => {
          sourceLists += 1;
          const source = sourceLists === 1 ? exampleSource : { ...exampleSource, image_count: 3400 };
          return { items: [source], next_cursor: null };
        },
      },
      { method: "GET", path: /\/sources\/[^/]+\/stats$/, body: exampleStats },
      {
        method: "GET",
        path: /\/jobs\/[^/]+$/,
        body: () => {
          jobPolls += 1;
          return jobPolls === 1
            ? runningJob
            : { ...runningJob, state: "succeeded", progress: 1, finished_at: "2026-09-17T10:40:00Z" };
        },
      },
      { method: "POST", path: /\/sources$/, status: 202, body: { source: exampleSource, job: runningJob } },
    ]);
    renderWithProviders(<SourcesSection projectId={PROJECT_ID} />, { api });
    const section = await screen.findByTestId("sources-section");
    await waitFor(() => expect(section).toHaveTextContent("3299 images"));
    fireEvent.click(screen.getByRole("button", { name: "Stats" }));
    await waitFor(() => expect(section).toHaveTextContent("3269 unlabeled"));

    fireEvent.click(screen.getByRole("button", { name: "Re-import new files" }));
    // The job is still running after the first poll: the counts must not be re-read yet.
    await waitFor(() => expect(jobPolls).toBe(1));
    expect(sourceLists).toBe(1);

    // The second poll reports success, which is when the new counts become visible.
    await waitFor(() => expect(section).toHaveTextContent("3400 images"), { timeout: 6000 });
    expect(sourceLists).toBe(2);
    expect(section).not.toHaveTextContent("3269 unlabeled");
  }, 15000);

  it("keeps the sources already on screen when a re-list fails", async () => {
    let sourceLists = 0;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const fetchImpl: typeof fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      if (req.method === "POST") return json({ source: exampleSource, job: runningJob }, 202);
      const { pathname } = new URL(req.url);
      if (pathname.includes("/jobs/")) {
        return json({ ...runningJob, state: "succeeded", progress: 1, finished_at: "2026-09-17T10:40:00Z" });
      }
      sourceLists += 1;
      return sourceLists === 1
        ? json({ items: [exampleSource], next_cursor: null })
        : json(errorBody("internal_error", "db locked"), 500);
    };
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl });
    renderWithProviders(<SourcesSection projectId={PROJECT_ID} />, { api });
    const section = await screen.findByTestId("sources-section");
    await waitFor(() => expect(section).toHaveTextContent("3299 images"));
    fireEvent.click(screen.getByRole("button", { name: "Re-import new files" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("db locked"));
    expect(section).toHaveTextContent("3299 images");
  });

  it("tolerates 501", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/sources$/, status: 501, body: errorBody("not_implemented", "S1 later") },
    ]);
    renderWithProviders(<SourcesSection projectId={PROJECT_ID} />, { api });
    expect(await screen.findByRole("note")).toHaveTextContent("Sources are not available yet");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
