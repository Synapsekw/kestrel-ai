import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import {
  errorBody,
  exampleDataset,
  exampleGeoMap,
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
import { useProjectKindStore } from "./useProjectKind";
import { useProjectProgress } from "./useProjectProgress";

function Probe({ projectId }: { projectId: string }) {
  const { progress } = useProjectProgress(projectId);
  return <pre data-testid="progress">{progress ? JSON.stringify(progress) : "none"}</pre>;
}

describe("useProjectProgress", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {}, panelOpen: false });
    useProgressStore.setState({ byProject: {} });
    useProjectKindStore.setState({ byProject: { [PROJECT_ID]: "train" } });
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
        path: /\/library\/models$/,
        body: {
          items: [
            exampleModel,
            exampleTrainedModel,
            { ...exampleTrainedModel, id: "m-elsewhere", provenance: { project_id: "another-project" } },
          ],
          next_cursor: null,
        },
      },
      { method: "GET", path: /\/query-runs/, body: { items: [exampleQueryRun], next_cursor: null } },
      { method: "GET", path: /\/maps$/, body: { items: [exampleGeoMap] } },
    ]);
    renderWithProviders(<Probe projectId={PROJECT_ID} />, { api });
    await waitFor(() => expect(screen.getByTestId("progress")).not.toHaveTextContent("none"));
    expect(JSON.parse(screen.getByTestId("progress").textContent ?? "")).toEqual({
      images: 40,
      labeled: 14,
      pendingReview: 3,
      datasets: 1,
      models: 3,
      trainedModels: 1,
      queryRuns: 1,
      maps: 1,
    });
    expect(useProgressStore.getState().byProject[PROJECT_ID]?.images).toBe(40);
  });

  it("counts no models when the library cannot be opened, and still loads the rest", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/stats$/, body: { ...exampleStats, image_count: 40 } },
      { method: "GET", path: /\/datasets$/, body: { items: [], next_cursor: null } },
      {
        method: "GET",
        path: /\/library\/models$/,
        status: 503,
        body: { error: { code: "library_unavailable", message: "down", details: {} } },
      },
      { method: "GET", path: /\/query-runs/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/maps$/, body: { items: [] } },
    ]);
    renderWithProviders(<Probe projectId={PROJECT_ID} />, { api });
    await waitFor(() => expect(screen.getByTestId("progress")).not.toHaveTextContent("none"));
    expect(JSON.parse(screen.getByTestId("progress").textContent ?? "")).toMatchObject({
      images: 40,
      models: 0,
      trainedModels: 0,
    });
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
      maps: 0,
    });
    const { api, requests } = fakeClient([]);
    renderWithProviders(<Probe projectId={PROJECT_ID} />, { api });
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId("progress")).toHaveTextContent('"images":7');
  });

  it("never asks a detection project for datasets, and counts its maps", async () => {
    useProjectKindStore.getState().set(PROJECT_ID, "detect");
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/stats$/, body: { ...exampleStats, image_count: 12, labeled_count: 0 } },
      { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
      { method: "GET", path: /\/query-runs/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/maps$/, body: { items: [exampleGeoMap, { ...exampleGeoMap, id: "m2" }] } },
    ]);
    renderWithProviders(<Probe projectId={PROJECT_ID} />, { api });
    await waitFor(() => expect(screen.getByTestId("progress")).not.toHaveTextContent("none"));
    expect(JSON.parse(screen.getByTestId("progress").textContent ?? "")).toMatchObject({
      images: 12,
      datasets: 0,
      maps: 2,
    });
    expect(requests.some((r) => r.url.includes("/datasets"))).toBe(false);
  });

  it("still fills the counts when the kind failed to load and the datasets read is refused", async () => {
    useProjectKindStore.getState().set(PROJECT_ID, "failed");
    const { api } = fakeClient([
      { method: "GET", path: /\/stats$/, body: { ...exampleStats, image_count: 9 } },
      { method: "GET", path: /\/datasets$/, status: 409, body: errorBody("wrong_project_kind", "no") },
      { method: "GET", path: /\/models$/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/query-runs/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/maps$/, body: { items: [] } },
    ]);
    renderWithProviders(<Probe projectId={PROJECT_ID} />, { api });
    await waitFor(() => expect(screen.getByTestId("progress")).not.toHaveTextContent("none"));
    expect(JSON.parse(screen.getByTestId("progress").textContent ?? "")).toMatchObject({
      images: 9,
      datasets: 0,
    });
  });

  it("waits for the project's kind before loading", async () => {
    useProjectKindStore.setState({ byProject: {} });
    const { api, requests } = fakeClient([]);
    renderWithProviders(<Probe projectId={PROJECT_ID} />, { api });
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    // The kind comes first; the counts follow once it is known (or could not be loaded).
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}`);
  });
});
