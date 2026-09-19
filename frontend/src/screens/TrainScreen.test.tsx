import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  errorBody,
  exampleDataset,
  exampleJobLog,
  exampleModel,
  fakeClient,
  PROJECT_ID,
  runningJob,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { TrainScreen } from "./TrainScreen";

const lists = [
  { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset], next_cursor: null } },
  { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
];

describe("TrainScreen", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("posts the training request, tracks the job in ?job= and shows the progress card", async () => {
    const { api, requests } = fakeClient([
      ...lists,
      {
        method: "POST",
        path: /\/models\/train$/,
        status: 202,
        body: { job: { ...runningJob, type: "train" } },
      },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: { ...runningJob, type: "train" } },
      { method: "GET", path: /\/log$/, body: exampleJobLog },
    ]);
    renderWithProviders(<TrainScreen />, {
      api,
      route: `/p/${PROJECT_ID}/train`,
      path: "/p/:projectId/train",
    });
    await waitFor(() => expect(screen.getByLabelText("Dataset")).toHaveValue(exampleDataset.id));
    fireEvent.change(screen.getByLabelText("Epochs"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Start training" }));
    await waitFor(() => expect(screen.getByTestId("train-progress")).toBeInTheDocument());
    const post = requests.find((r) => r.method === "POST");
    expect(post).toMatchObject({
      url: `/api/v1/projects/${PROJECT_ID}/models/train`,
      body: {
        name: "v1-yolo11m-coco",
        dataset_id: exampleDataset.id,
        base_model_id: exampleModel.id,
        epochs: 3,
        imgsz: 1280,
        batch: null,
        patience: 50,
        augmentation: "default",
        device: "0",
      },
    });
    expect(useJobsStore.getState().jobs[runningJob.id].type).toBe("train");
    expect(screen.getByRole("button", { name: "New training" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New training" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start training" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Show/ })).toBeInTheDocument();
  });

  it("preselects the dataset named by ?dataset=", async () => {
    const older = { ...exampleDataset, id: "older-dataset", name: "v0" };
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset, older], next_cursor: null } },
      { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
    ]);
    renderWithProviders(<TrainScreen />, {
      api,
      route: `/p/${PROJECT_ID}/train?dataset=${older.id}`,
      path: "/p/:projectId/train",
    });
    await waitFor(() => expect(screen.getByLabelText("Dataset")).toHaveValue(older.id));
  });

  it("shows the not-available note on 501 without breaking the form", async () => {
    const { api } = fakeClient([
      ...lists,
      {
        method: "POST",
        path: /\/models\/train$/,
        status: 501,
        body: errorBody("not_implemented", "S3 later"),
      },
    ]);
    renderWithProviders(<TrainScreen />, {
      api,
      route: `/p/${PROJECT_ID}/train`,
      path: "/p/:projectId/train",
    });
    await waitFor(() => expect(screen.getByLabelText("Dataset")).toHaveValue(exampleDataset.id));
    fireEvent.click(screen.getByRole("button", { name: "Start training" }));
    await waitFor(() => expect(screen.getByRole("note")).toHaveTextContent("Training is not available yet"));
    expect(screen.getByRole("button", { name: "Start training" })).toBeEnabled();
  });
});
