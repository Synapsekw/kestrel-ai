import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { exampleDataset, exampleModel, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { TrainForm } from "./TrainForm";

// The dataset and model lists arrive after the form mounts (and change again when a training
// job finishes). Whatever the user typed must survive; untouched fields take the new defaults.
function mount(
  datasets: (typeof exampleDataset)[],
  models: (typeof exampleModel)[],
  initialDatasetId?: string,
) {
  const { api } = fakeClient([]);
  const onStart = vi.fn();
  const props = {
    projectId: PROJECT_ID,
    datasetsUnavailable: false,
    modelsUnavailable: false,
    modelsLoading: false,
    modelsError: null,
    busy: false,
    onStart,
    initialDatasetId,
  };
  const tree = (ds: typeof datasets, ms: typeof models) => (
    <TestApiProvider api={api}>
      <MemoryRouter>
        <TrainForm {...props} datasets={ds} models={ms} />
      </MemoryRouter>
    </TestApiProvider>
  );
  const view = render(tree(datasets, models));
  return { rerender: (ds: typeof datasets, ms: typeof models) => view.rerender(tree(ds, ms)) };
}

describe("TrainForm when the lists arrive late", () => {
  it("keeps the typed name and epochs and only fills the untouched pickers", () => {
    const { rerender } = mount([], []);
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "cp3-model" } });
    fireEvent.change(screen.getByLabelText("Epochs"), { target: { value: "1" } });
    rerender([exampleDataset], [exampleModel]);
    expect(screen.getByLabelText("Model name")).toHaveValue("cp3-model");
    expect(screen.getByLabelText("Epochs")).toHaveValue(1);
    expect(screen.getByLabelText("Dataset")).toHaveValue(exampleDataset.id);
    expect(screen.getByLabelText("Base model")).toHaveValue(exampleModel.id);
  });

  it("suggests the name once both pickers can be filled and the user has not typed one", () => {
    const { rerender } = mount([], []);
    expect(screen.getByLabelText("Model name")).toHaveValue("");
    rerender([exampleDataset], [exampleModel]);
    expect(screen.getByLabelText("Model name")).toHaveValue("v1-yolo11m-coco");
  });

  it("falls back to the first dataset once the list arrives and an unknown ?dataset= id is not in it (I5)", () => {
    const { rerender } = mount([], [], "nope-not-a-real-dataset");
    rerender([exampleDataset], [exampleModel]);
    expect(screen.getByLabelText("Dataset")).toHaveValue(exampleDataset.id);
    expect(screen.getByLabelText("Model name")).toHaveValue("v1-yolo11m-coco");
  });

  it("explains the fallback next to the picker when the linked dataset is gone (I-B2)", () => {
    const { rerender } = mount([], [], "nope-not-a-real-dataset");
    expect(screen.queryByText(/no longer exists/)).not.toBeInTheDocument();
    rerender([exampleDataset], [exampleModel]);
    expect(
      screen.getByText("The dataset from the link no longer exists; the newest one is selected instead."),
    ).toBeInTheDocument();
  });

  it("says nothing when the ?dataset= id is valid, or when none was given", () => {
    const { rerender } = mount([], [], exampleDataset.id);
    rerender([exampleDataset], [exampleModel]);
    expect(screen.queryByText(/no longer exists/)).not.toBeInTheDocument();

    const noId = mount([], []);
    noId.rerender([exampleDataset], [exampleModel]);
    expect(screen.queryByText(/no longer exists/)).not.toBeInTheDocument();
  });

  it("keeps a valid initialDatasetId once a later list arrives, even when it is not the first one", () => {
    const older = { ...exampleDataset, id: "older-dataset", name: "v0" };
    const { rerender } = mount([], [], older.id);
    rerender([exampleDataset, older], [exampleModel]);
    expect(screen.getByLabelText("Dataset")).toHaveValue(older.id);
  });
});
