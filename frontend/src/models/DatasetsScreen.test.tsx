import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { errorBody, fakeClient, IMAGE_ID, runningJob, type FakeRoute } from "@/test/fixtures";
import { exampleDatasetItems, exampleLibraryDataset, LIB_DATASET_ID } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { DatasetsScreen } from "./DatasetsScreen";

const LIST: FakeRoute = {
  method: "GET",
  path: /\/library\/datasets$/,
  body: { items: [exampleLibraryDataset], next_cursor: null },
};
const ITEMS: FakeRoute = { method: "GET", path: /\/items$/, body: exampleDatasetItems };

function renderDatasets(route: string, routes: FakeRoute[] = [LIST, ITEMS]) {
  const { api, requests } = fakeClient(routes);
  renderWithProviders(<DatasetsScreen />, { api, route, path: "/models/datasets/:datasetId?" });
  return requests;
}

describe("DatasetsScreen (F §12.4)", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("lists datasets with their sources, images, split and state", async () => {
    renderDatasets("/models/datasets");
    const row = await screen.findByRole("row", { name: /machines-v1/ });
    expect(row).toHaveTextContent("Ahmadia");
    expect(row).toHaveTextContent("30");
    expect(row).toHaveTextContent("24 / 6");
    expect(row).toHaveTextContent("Ready");
  });

  it("opens the detail with classes, sources, samples and the training link", async () => {
    renderDatasets(`/models/datasets/${LIB_DATASET_ID}`);
    expect(await screen.findByRole("heading", { name: "machines-v1" })).toBeInTheDocument();
    const classes = screen.getByTestId("dataset-classes");
    expect(within(classes).getByText("Dump truck")).toBeInTheDocument();
    expect(within(classes).getByText("72")).toBeInTheDocument();
    expect(screen.getByTestId("dataset-sources")).toHaveTextContent("E:\\Projects\\Ahmadia");
    const img = await screen.findByRole("img", { name: "train image, 3 labels" });
    expect(img.getAttribute("src")).toContain(`/images/${IMAGE_ID}/thumbnail`);
    expect(screen.getByRole("link", { name: "Train on this dataset" })).toHaveAttribute(
      "href",
      `/models/training?new=1&dataset=${LIB_DATASET_ID}`,
    );
  });

  it("builds the export as a job and shows it running", async () => {
    const requests = renderDatasets(`/models/datasets/${LIB_DATASET_ID}`, [
      LIST,
      ITEMS,
      {
        method: "POST",
        path: /\/export$/,
        status: 202,
        body: { job: { ...runningJob, id: "j-exp", project_id: "library", type: "dataset" } },
      },
      {
        method: "GET",
        path: /\/library\/jobs\/j-exp$/,
        body: { ...runningJob, id: "j-exp", project_id: "library", type: "dataset" },
      },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Build export" }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/export"))).toBe(true),
    );
    expect(await screen.findAllByText("Exporting")).not.toHaveLength(0);
  });

  it("deletes after a confirmation and returns to the list", async () => {
    const requests = renderDatasets(`/models/datasets/${LIB_DATASET_ID}`, [
      LIST,
      ITEMS,
      { method: "DELETE", path: /\/library\/datasets\/[^/]+$/, status: 204 },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Delete dataset" }));
    expect(screen.getByText(/Delete dataset machines-v1\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("row", { name: /machines-v1/ })).not.toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "machines-v1" })).not.toBeInTheDocument();
  });

  it("a dataset link that no longer exists says so", async () => {
    renderDatasets("/models/datasets/gone", [
      LIST,
      {
        method: "GET",
        path: /\/library\/datasets\/gone$/,
        status: 404,
        body: errorBody("not_found", "no dataset"),
      },
    ]);
    expect(await screen.findByText("That dataset no longer exists")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /machines-v1/ })).toBeInTheDocument();
  });

  it("blocks with the reason when the library is unavailable", async () => {
    renderDatasets("/models/datasets", [
      {
        method: "GET",
        path: /\/library\/datasets$/,
        status: 503,
        body: errorBody("library_unavailable", "no library"),
      },
    ]);
    expect(await screen.findByText("The model library could not be opened")).toBeInTheDocument();
  });
});
