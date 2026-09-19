import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { errorBody, exampleDataset, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { DatasetsScreen } from "./DatasetsScreen";

const STATS = {
  image_count: 30,
  train_count: 24,
  val_count: 6,
  boxes_per_class: [{ class_id: "c1", class_name: "excavator", train: 20, val: 5 }],
  groups: [],
};

describe("DatasetsScreen", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("lists datasets and opens the detail from the ?dataset= param", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset], next_cursor: null } },
      { method: "GET", path: /\/stats$/, body: STATS },
    ]);
    renderWithProviders(<DatasetsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/datasets?dataset=${exampleDataset.id}`,
      path: "/p/:projectId/datasets",
    });
    expect(await screen.findByRole("heading", { name: "Datasets" })).toBeInTheDocument();
    const table = await screen.findByTestId("dataset-table");
    expect(table).toHaveTextContent("v1");
    const detail = await screen.findByTestId("dataset-detail");
    expect(detail).toHaveTextContent("v1");
    await waitFor(() => expect(screen.getByTestId("dataset-class-stats")).toHaveTextContent("excavator"));
  });

  it("selects a dataset by clicking its row", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset], next_cursor: null } },
      { method: "GET", path: /\/stats$/, body: STATS },
    ]);
    renderWithProviders(<DatasetsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/datasets`,
      path: "/p/:projectId/datasets",
    });
    fireEvent.click(await screen.findByText("v1"));
    expect(await screen.findByTestId("dataset-detail")).toBeInTheDocument();
  });

  it("shows the empty state with links to the Images screen when there are no datasets", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, body: { items: [], next_cursor: null } },
    ]);
    renderWithProviders(<DatasetsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/datasets`,
      path: "/p/:projectId/datasets",
    });
    expect(await screen.findByText(/No datasets yet/)).toBeInTheDocument();
    expect(screen.getAllByRole("link").some((l) => l.getAttribute("href") === `/p/${PROJECT_ID}/data`)).toBe(
      true,
    );
  });

  it("shows the not-available note on 501", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, status: 501, body: errorBody("not_implemented", "later") },
    ]);
    renderWithProviders(<DatasetsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/datasets`,
      path: "/p/:projectId/datasets",
    });
    expect(await screen.findByRole("note")).toHaveTextContent("Datasets are not available yet");
  });

  it("opens the new-dataset form and reloads the list once the job is closed", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, body: { items: [], next_cursor: null } },
    ]);
    renderWithProviders(<DatasetsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/datasets`,
      path: "/p/:projectId/datasets",
    });
    fireEvent.click(await screen.findByRole("button", { name: "New dataset from all labeled images" }));
    expect(screen.getByRole("form", { name: "New dataset" })).toBeInTheDocument();
  });
});
