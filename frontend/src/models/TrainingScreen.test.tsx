import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  RESULTS_CSV,
  errorBody,
  exampleModel,
  fakeClient,
  JOB_ID,
  MODEL_ID,
  runningJob,
  TRAINED_MODEL_ID,
  type FakeRoute,
} from "@/test/fixtures";
import {
  exampleLibraryDataset,
  exampleTrainingRun,
  LIB_DATASET_ID,
  TRAINING_RUN_ID,
} from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { TrainingScreen } from "./TrainingScreen";

const BASE: FakeRoute[] = [
  {
    method: "GET",
    path: /\/library\/training-runs$/,
    body: { items: [exampleTrainingRun], next_cursor: null },
  },
  {
    method: "GET",
    path: /\/library\/datasets$/,
    body: { items: [exampleLibraryDataset], next_cursor: null },
  },
  { method: "GET", path: /\/library\/models$/, body: { items: [exampleModel], next_cursor: null } },
  {
    method: "GET",
    path: /\/library\/jobs\/[^/]+$/,
    body: {
      ...runningJob,
      id: JOB_ID,
      project_id: "library",
      type: "train",
      state: "succeeded",
      progress: 1,
      message: "epoch 3/3 mAP50 0.710",
      result: { model_id: TRAINED_MODEL_ID },
    },
  },
  { method: "GET", path: /\/artifacts\/results_csv$/, body: RESULTS_CSV, raw: true },
  { method: "GET", path: /\/jobs\/[^/]+\/log$/, body: { lines: [], path: "x" } },
];

function renderTraining(route: string, extra: FakeRoute[] = []) {
  const { api, requests } = fakeClient([...extra, ...BASE]);
  renderWithProviders(<TrainingScreen />, { api, route, path: "/models/training/:runId?" });
  return requests;
}

describe("TrainingScreen (F §12.4)", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("lists runs with dataset, base model, best mAP50 and duration", async () => {
    renderTraining("/models/training");
    const row = await screen.findByRole("row", { name: /machines-v1-yolo11m-coco/ });
    await waitFor(() => expect(row).toHaveTextContent("yolo11m-coco"));
    expect(row).toHaveTextContent("machines-v1");
    expect(row).toHaveTextContent("71.0%");
    expect(row).toHaveTextContent("42 min 00 s");
  });

  it("opens a run with its live card and its training curve", async () => {
    renderTraining(`/models/training/${TRAINING_RUN_ID}`);
    expect(await screen.findByTestId("train-progress")).toBeInTheDocument();
    expect(await screen.findByTestId("training-curve")).toHaveAttribute("data-points", "3");
  });

  it("starts a run from the drawer with the linked dataset and opens it", async () => {
    const started = {
      ...exampleTrainingRun,
      id: "t-new",
      state: "queued" as const,
      model_id: null,
      metrics: null,
      finished_at: null,
    };
    const requests = renderTraining(`/models/training?new=1&dataset=${LIB_DATASET_ID}`, [
      {
        method: "POST",
        path: /\/library\/training-runs$/,
        status: 202,
        body: {
          training_run: started,
          job: { ...runningJob, id: "j-train", project_id: "library", type: "train" },
        },
      },
      { method: "GET", path: /\/library\/training-runs\/t-new$/, body: started },
    ]);
    expect(await screen.findByRole("heading", { name: "New training run" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Dataset")).toHaveValue(LIB_DATASET_ID));
    await waitFor(() => expect(screen.getByLabelText("Base model")).toHaveValue(MODEL_ID));
    fireEvent.click(screen.getByRole("button", { name: "Start training" }));
    await waitFor(() =>
      expect(requests.find((r) => r.method === "POST")?.body).toEqual({
        name: "machines-v1-yolo11m-coco",
        dataset_id: LIB_DATASET_ID,
        base_model_id: MODEL_ID,
        epochs: 50,
        imgsz: 1280,
        batch: null,
        patience: 50,
        augmentation: "default",
        device: "0",
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "machines-v1-yolo11m-coco", level: 2 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "New training run" })).not.toBeInTheDocument();
  });

  it("offers only ready datasets in the drawer", async () => {
    renderTraining("/models/training?new=1", [
      {
        method: "GET",
        path: /\/library\/datasets$/,
        body: {
          items: [{ ...exampleLibraryDataset, id: "d-building", name: "still-building", state: "resolving" }],
          next_cursor: null,
        },
      },
    ]);
    await screen.findByRole("heading", { name: "New training run" });
    expect(screen.queryByRole("option", { name: /still-building/ })).not.toBeInTheDocument();
  });

  it("a run link that no longer exists says so", async () => {
    renderTraining("/models/training/gone", [
      {
        method: "GET",
        path: /\/library\/training-runs\/gone$/,
        status: 404,
        body: errorBody("not_found", "no run"),
      },
    ]);
    expect(await screen.findByText("That training run no longer exists")).toBeInTheDocument();
  });

  it("shows the compare view from ?compare= and closes it", async () => {
    const second = { ...exampleTrainingRun, id: "t-2b", name: "machines-v1-e100", model_id: "m-2b" };
    renderTraining(`/models/training?compare=${TRAINING_RUN_ID},t-2b`, [
      {
        method: "GET",
        path: /\/library\/training-runs$/,
        body: { items: [exampleTrainingRun, second], next_cursor: null },
      },
    ]);
    expect(await screen.findByRole("img", { name: /mAP50 of 2 runs/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close compare" }));
    expect(screen.queryByRole("img", { name: /mAP50 of 2 runs/ })).not.toBeInTheDocument();
  });

  it("keeps Compare off until two runs with a model are chosen", async () => {
    renderTraining("/models/training");
    await screen.findByRole("row", { name: /machines-v1-yolo11m-coco/ });
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
  });

  describe("a dataset another job is exporting (H8)", () => {
    const BUSY_NOTE = "Another run is preparing this dataset; start when it has finished.";
    const activeRun = {
      ...exampleTrainingRun,
      id: "t-active",
      state: "running" as const,
      model_id: null,
      metrics: null,
      finished_at: null,
    };

    function renderDrawer(
      exportState: (typeof exampleLibraryDataset)["export_state"],
      runs = [exampleTrainingRun],
    ) {
      renderTraining(`/models/training?new=1&dataset=${LIB_DATASET_ID}`, [
        { method: "GET", path: /\/library\/training-runs$/, body: { items: runs, next_cursor: null } },
        {
          method: "GET",
          path: /\/library\/datasets$/,
          body: { items: [{ ...exampleLibraryDataset, export_state: exportState }], next_cursor: null },
        },
      ]);
    }

    it("cannot start while the dataset's export is building", async () => {
      renderDrawer("building");
      await waitFor(() => expect(screen.getByLabelText("Dataset")).toHaveValue(LIB_DATASET_ID));
      expect(screen.getByRole("button", { name: "Start training" })).toBeDisabled();
      expect(screen.getByText(BUSY_NOTE)).toBeInTheDocument();
    });

    it("cannot start while an active run will export the same not-ready dataset", async () => {
      renderDrawer("stale", [activeRun]);
      await waitFor(() => expect(screen.getByLabelText("Dataset")).toHaveValue(LIB_DATASET_ID));
      await waitFor(() => expect(screen.getByRole("button", { name: "Start training" })).toBeDisabled());
      expect(screen.getByText(BUSY_NOTE)).toBeInTheDocument();
    });

    it("can start alongside an active run once the export is ready", async () => {
      renderDrawer("ready", [activeRun]);
      await waitFor(() => expect(screen.getByLabelText("Dataset")).toHaveValue(LIB_DATASET_ID));
      await screen.findByRole("row", { name: /machines-v1-yolo11m-coco/ });
      expect(screen.getByRole("button", { name: "Start training" })).toBeEnabled();
      expect(screen.queryByText(BUSY_NOTE)).not.toBeInTheDocument();
    });
  });
});
