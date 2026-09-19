import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { exampleDataset, exampleModel, exampleTrainedModel, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { TrainForm } from "./TrainForm";

describe("TrainForm", () => {
  it("preselects the first dataset and model, suggests a name and submits the request", () => {
    const { api } = fakeClient([]);
    const onStart = vi.fn();
    renderWithProviders(
      <TrainForm
        projectId={PROJECT_ID}
        datasets={[exampleDataset]}
        models={[exampleModel, exampleTrainedModel]}
        datasetsUnavailable={false}
        modelsUnavailable={false}
        modelsLoading={false}
        modelsError={null}
        busy={false}
        onStart={onStart}
      />,
      { api },
    );
    expect(screen.getByLabelText("Dataset")).toHaveValue(exampleDataset.id);
    expect(screen.getByLabelText("Base model")).toHaveValue(exampleModel.id);
    expect(screen.getByLabelText("Model name")).toHaveValue("v1-yolo11m-coco");
    expect(screen.getByLabelText("Image size")).toHaveValue(1280);
    expect(screen.getByLabelText("Automatic batch size")).toBeChecked();
    expect(screen.getByLabelText("Batch size")).toBeDisabled();
    expect(screen.getByRole("link", { name: "Create dataset" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/data`,
    );
    // "30 images" also appears in the option label, so match the split summary line.
    expect(screen.getByText(/30 images: 24 train \/ 6 val/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Epochs"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Augmentation"), { target: { value: "aerial" } });
    fireEvent.click(screen.getByLabelText("Automatic batch size"));
    fireEvent.change(screen.getByLabelText("Batch size"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Start training" }));
    expect(onStart).toHaveBeenCalledWith({
      name: "v1-yolo11m-coco",
      dataset_id: exampleDataset.id,
      base_model_id: exampleModel.id,
      epochs: 3,
      imgsz: 1280,
      batch: 8,
      patience: 50,
      augmentation: "aerial",
      device: "0",
    });
  });

  it("preselects the dataset named by initialDatasetId over the newest one", () => {
    const older = { ...exampleDataset, id: "older-dataset", name: "v0" };
    const { api } = fakeClient([]);
    renderWithProviders(
      <TrainForm
        projectId={PROJECT_ID}
        datasets={[exampleDataset, older]}
        models={[exampleModel]}
        datasetsUnavailable={false}
        modelsUnavailable={false}
        modelsLoading={false}
        modelsError={null}
        busy={false}
        onStart={() => {}}
        initialDatasetId={older.id}
      />,
      { api },
    );
    expect(screen.getByLabelText("Dataset")).toHaveValue(older.id);
    expect(screen.getByLabelText("Model name")).toHaveValue("v0-yolo11m-coco");
  });

  it("refuses an invalid form and explains missing datasets", () => {
    const { api } = fakeClient([]);
    const onStart = vi.fn();
    renderWithProviders(
      <TrainForm
        projectId={PROJECT_ID}
        datasets={[]}
        models={[exampleModel]}
        datasetsUnavailable={true}
        modelsUnavailable={false}
        modelsLoading={false}
        modelsError={null}
        busy={false}
        onStart={onStart}
      />,
      { api },
    );
    expect(screen.getByRole("note")).toHaveTextContent("Datasets are not available yet");
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Start training" }));
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a dataset.");
  });

  it("points to a starter model when the registry has loaded, is available and empty", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <TrainForm
        projectId={PROJECT_ID}
        datasets={[exampleDataset]}
        models={[]}
        datasetsUnavailable={false}
        modelsUnavailable={false}
        modelsLoading={false}
        modelsError={null}
        busy={false}
        onStart={() => {}}
      />,
      { api },
    );
    expect(screen.queryByText(/Any registry model, including imported COCO weights/)).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Add a starter model" });
    expect(link).toHaveAttribute("href", `/p/${PROJECT_ID}/models`);
  });

  it("shows the usual base model help text once the registry has a model", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <TrainForm
        projectId={PROJECT_ID}
        datasets={[exampleDataset]}
        models={[exampleModel]}
        datasetsUnavailable={false}
        modelsUnavailable={false}
        modelsLoading={false}
        modelsError={null}
        busy={false}
        onStart={() => {}}
      />,
      { api },
    );
    expect(screen.getByText(/Any registry model, including imported COCO weights/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add a starter model" })).not.toBeInTheDocument();
  });

  it("does not offer a starter model while the registry is still loading", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <TrainForm
        projectId={PROJECT_ID}
        datasets={[exampleDataset]}
        models={[]}
        datasetsUnavailable={false}
        modelsUnavailable={false}
        modelsLoading={true}
        modelsError={null}
        busy={false}
        onStart={() => {}}
      />,
      { api },
    );
    expect(screen.queryByRole("link", { name: "Add a starter model" })).not.toBeInTheDocument();
  });

  it("does not offer a starter model when the registry is unavailable", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <TrainForm
        projectId={PROJECT_ID}
        datasets={[exampleDataset]}
        models={[]}
        datasetsUnavailable={false}
        modelsUnavailable={true}
        modelsLoading={false}
        modelsError={null}
        busy={false}
        onStart={() => {}}
      />,
      { api },
    );
    expect(screen.queryByRole("link", { name: "Add a starter model" })).not.toBeInTheDocument();
  });

  it("does not offer a starter model while the registry failed to load", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <TrainForm
        projectId={PROJECT_ID}
        datasets={[exampleDataset]}
        models={[]}
        datasetsUnavailable={false}
        modelsUnavailable={false}
        modelsLoading={false}
        modelsError="could not load the model registry"
        busy={false}
        onStart={() => {}}
      />,
      { api },
    );
    expect(screen.queryByRole("link", { name: "Add a starter model" })).not.toBeInTheDocument();
  });

  it("explains the parameters and warns about a dataset too small to learn from", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <TrainForm
        projectId={PROJECT_ID}
        datasets={[{ ...exampleDataset, image_count: 14, train_count: 8, val_count: 6 }]}
        models={[exampleModel]}
        datasetsUnavailable={false}
        modelsUnavailable={false}
        modelsLoading={false}
        modelsError={null}
        busy={false}
        onStart={() => {}}
      />,
      { api },
    );
    expect(screen.getByTestId("train-advice")).toHaveTextContent("Only 8 training images");
    expect(screen.getByText(/Passes over the training images/)).toBeInTheDocument();
    expect(screen.getByText(/1280 keeps small machines visible/)).toBeInTheDocument();
    expect(screen.getByText(/Stops early after this many epochs without improvement/)).toBeInTheDocument();
    // The warning informs; it does not block a deliberate smoke test.
    expect(screen.getByRole("button", { name: "Start training" })).toBeEnabled();
  });
});
