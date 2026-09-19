import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import {
  exampleDataset,
  exampleModel,
  exampleQueryRun,
  exampleStats,
  exampleTrainedModel,
  fakeClient,
  PROJECT_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { useProgressStore } from "@/store/progress";
import { useProjectProgress } from "./useProjectProgress";

function Probe({ projectId }: { projectId: string }) {
  const { progress } = useProjectProgress(projectId);
  return <pre data-testid="progress">{progress ? JSON.stringify(progress) : "none"}</pre>;
}

describe("useProjectProgress", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {}, panelOpen: false });
    useProgressStore.setState({ byProject: {} });
  });

  it("loads the counts into the store", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/stats$/,
        body: { ...exampleStats, image_count: 40, labeled_count: 14, pending_review_count: 3 },
      },
      { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset], next_cursor: null } },
      {
        method: "GET",
        path: /\/models$/,
        body: { items: [exampleModel, exampleTrainedModel], next_cursor: null },
      },
      { method: "GET", path: /\/query-runs/, body: { items: [exampleQueryRun], next_cursor: null } },
    ]);
    renderWithProviders(<Probe projectId={PROJECT_ID} />, { api });
    await waitFor(() => expect(screen.getByTestId("progress")).not.toHaveTextContent("none"));
    expect(JSON.parse(screen.getByTestId("progress").textContent ?? "")).toEqual({
      images: 40,
      labeled: 14,
      pendingReview: 3,
      datasets: 1,
      models: 2,
      trainedModels: 1,
      queryRuns: 1,
    });
    expect(useProgressStore.getState().byProject[PROJECT_ID]?.images).toBe(40);
  });

  it("keeps the last value when a reload fails", async () => {
    useProgressStore.getState().set(PROJECT_ID, {
      images: 7,
      labeled: 0,
      pendingReview: 0,
      datasets: 0,
      models: 0,
      trainedModels: 0,
      queryRuns: 0,
    });
    const { api, requests } = fakeClient([]);
    renderWithProviders(<Probe projectId={PROJECT_ID} />, { api });
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId("progress")).toHaveTextContent('"images":7');
  });
});
