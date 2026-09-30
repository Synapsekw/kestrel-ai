import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { exampleStats, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { DataExportsPanel } from "./DataExportsPanel";

function renderPanel(routes: Parameters<typeof fakeClient>[0]) {
  // A test's own routes come first, so it can answer a request the defaults also match.
  const { api, requests } = fakeClient([
    ...routes,
    { method: "GET", path: /\/stats$/, body: exampleStats },
    { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
    { method: "GET", path: /\/jobs$/, body: { items: [], next_cursor: null } },
  ]);
  renderWithProviders(<DataExportsPanel projectId={PROJECT_ID} />, { api });
  return { api, requests };
}

describe("DataExportsPanel", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {} });
  });

  it("shows the counts, the results form and past exports, with no page heading and no model block", async () => {
    renderPanel([]);
    expect(screen.getByRole("region", { name: "Data exports" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(
      await screen.findByText(/Exports all \d+ images?: \d+ accepted boxe?s? on the \d+ checked images?/),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Counts" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Image contact sheet \(HTML\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Past exports" })).toBeInTheDocument();
    expect(screen.getByText("No exports yet")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Model for other applications" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open the library" })).not.toBeInTheDocument();
  });

  it("links the exports that stay in their workspaces", () => {
    renderPanel([]);
    const elsewhere = screen.getByRole("region", { name: "Exports in their workspaces" });
    expect(within(elsewhere).getByRole("link", { name: "Open the Map workspace" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/maps`,
    );
    expect(within(elsewhere).getByRole("link", { name: "Open Point clouds" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/clouds`,
    );
    expect(within(elsewhere).getByRole("link", { name: "Open surfaces and volumes" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/measurements/volumes`,
    );
  });

  it("starts an export from the form and it appears under Past exports (via the shared jobs store)", async () => {
    const succeeded = {
      ...runningJob,
      type: "results_export" as const,
      state: "succeeded" as const,
      result: {
        folder: "exports/2026-09-19_101500",
        files: ["detections.csv"],
        image_count: 2,
        box_count: 3,
      },
    };
    renderPanel([{ method: "POST", path: /\/exports$/, status: 202, body: { job: succeeded } }]);
    const results = await screen.findByRole("region", { name: "Results" });
    fireEvent.click(within(results).getByRole("button", { name: "Export" }));
    expect(await screen.findByTestId(`export-job-${succeeded.id}`)).toHaveTextContent("2 images, 3 boxes");
  });

  it("never shows another project's results_export job under Past exports", async () => {
    const otherProjectsJob = {
      ...runningJob,
      id: "j-other-project",
      project_id: "some-other-project-id",
      type: "results_export" as const,
      state: "succeeded" as const,
      result: { folder: "exports/x", files: ["detections.csv"], image_count: 1, box_count: 1 },
    };
    useJobsStore.getState().upsert(otherProjectsJob);
    renderPanel([]);
    expect(await screen.findByText("No exports yet")).toBeInTheDocument();
    expect(screen.queryByTestId(`export-job-${otherProjectsJob.id}`)).not.toBeInTheDocument();
  });

  it("shows the counts CSV with its past export, and the Survey count report link", async () => {
    const done = {
      ...runningJob,
      id: "j-detect-export",
      type: "detect_export" as const,
      state: "succeeded" as const,
      result: {
        folder: "exports/2026-09-24_101500",
        files: ["detect-site-2026-09-24.csv"],
        source_count: 2,
      },
    };
    renderPanel([
      {
        method: "GET",
        path: /\/jobs$/,
        body: (r: { url: string }) => ({
          items: r.url.includes("detect_export") ? [done] : [],
          next_cursor: null,
        }),
      },
    ]);
    const counts = await screen.findByRole("region", { name: "Counts" });
    expect(within(counts).getByRole("link", { name: "Create a Survey count report" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/reports?new=builtin-survey-counts`,
    );
    const row = await screen.findByTestId("export-job-j-detect-export");
    expect(row).toHaveTextContent("detect-site-2026-09-24.csv");
    expect(row).toHaveTextContent("Detection export");
    expect(screen.getByRole("button", { name: "Show in folder" })).toBeInTheDocument();
  });

  it("shows a stats failure and still offers the forms", async () => {
    renderPanel([
      {
        method: "GET",
        path: /\/stats$/,
        status: 500,
        body: { error: { code: "http_error", message: "stats broke", details: {} } },
      },
    ]);
    expect(await screen.findByText("stats broke")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Results" })).toBeInTheDocument();
  });
});
