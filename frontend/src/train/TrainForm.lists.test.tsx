import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { exampleDataset, exampleModel, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { TrainForm } from "./TrainForm";

// The dataset and model lists arrive after the form mounts (and change again when a training
// job finishes). Whatever the user typed must survive; untouched fields take the new defaults.
function mount(datasets: (typeof exampleDataset)[], models: (typeof exampleModel)[]) {
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
});
