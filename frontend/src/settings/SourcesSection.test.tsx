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

  it("tolerates 501", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/sources$/, status: 501, body: errorBody("not_implemented", "S1 later") },
    ]);
    renderWithProviders(<SourcesSection projectId={PROJECT_ID} />, { api });
    expect(await screen.findByRole("note")).toHaveTextContent("Sources are not available yet");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
