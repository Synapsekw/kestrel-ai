import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { exampleStats, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useProjectKindStore } from "@/app/useProjectKind";
import { useJobsStore } from "@/store/jobs";
import { ExportScreen } from "./ExportScreen";

function renderScreen(routes: Parameters<typeof fakeClient>[0]) {
  // A test's own routes come first, so it can answer a request the defaults also match.
  const { api, requests } = fakeClient([
    ...routes,
    { method: "GET", path: /\/stats$/, body: exampleStats },
    { method: "GET", path: /\/jobs$/, body: { items: [], next_cursor: null } },
  ]);
  renderWithProviders(<ExportScreen />, {
    api,
    route: `/p/${PROJECT_ID}/export`,
    path: "/p/:projectId/export",
  });
  return { api, requests };
}

describe("ExportScreen", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {}, panelOpen: false });
    useProjectKindStore.setState({ byProject: { [PROJECT_ID]: "train" } });
  });

  it("shows the Export heading, the results form and points model exports to the library", async () => {
    renderScreen([]);
    expect(screen.getByRole("heading", { name: "Export" })).toBeInTheDocument();
    expect(
      await screen.findByText(/Exports all \d+ images?: \d+ accepted boxe?s? on the \d+ checked images?/),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Past exports" })).toBeInTheDocument();
    expect(screen.getByText("No exports yet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Model for other applications" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the library" })).toHaveAttribute("href", "/library");
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
    renderScreen([{ method: "POST", path: /\/exports$/, status: 202, body: { job: succeeded } }]);
    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
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
    renderScreen([]);
    expect(await screen.findByText("No exports yet")).toBeInTheDocument();
    expect(screen.queryByTestId(`export-job-${otherProjectsJob.id}`)).not.toBeInTheDocument();
  });

  it("shows neither kind's section while the project kind is still loading", async () => {
    useProjectKindStore.setState({ byProject: {} });
    // No project route, so the kind never loads: the screen stays as it is while the request is out.
    renderScreen([]);
    expect(screen.queryByRole("heading", { name: "Model for other applications" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Past exports" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Model for other applications" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Counts" })).not.toBeInTheDocument();
  });

  describe("in a detection project", () => {
    beforeEach(() => useProjectKindStore.setState({ byProject: { [PROJECT_ID]: "detect" } }));

    it("leads with the counts export and lists a finished detection export under Past exports", async () => {
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
      renderScreen([
        { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
        {
          method: "GET",
          path: /\/jobs$/,
          body: (r: { url: string }) => ({
            items: r.url.includes("detect_export") ? [done] : [],
            next_cursor: null,
          }),
        },
      ]);
      expect(await screen.findByRole("region", { name: "Counts" })).toBeInTheDocument();
      expect(screen.getByText(/map viewer/)).toBeInTheDocument();
      const row = await screen.findByTestId("export-job-j-detect-export");
      expect(row).toHaveTextContent("detect-site-2026-09-24.csv");
      expect(screen.getByRole("button", { name: "Show in folder" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Model for other applications" })).not.toBeInTheDocument();
    });
  });
});
