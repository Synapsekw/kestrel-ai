import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { exampleModel, exampleTrainedModel, fakeClient } from "@/test/fixtures";
import { exampleTrainable } from "@/test/appSectionFixtures";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders, TestApiProvider } from "@/test/render";
import { TrainForm } from "./TrainForm";

describe("TrainForm", () => {
  it("preselects the first dataset and model, suggests a name and submits the request", () => {
    const { api } = fakeClient([]);
    const onStart = vi.fn();
    renderWithProviders(
      <TrainForm
        datasets={[exampleTrainable]}
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
    expect(screen.getByLabelText("Dataset")).toHaveValue(exampleTrainable.id);
    expect(screen.getByLabelText("Base model")).toHaveValue(exampleModel.id);
    expect(screen.getByLabelText("Model name")).toHaveValue("v1-yolo11m-coco");
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByLabelText("Image size")).toHaveValue(1280);
    expect(screen.getByLabelText("Automatic batch size")).toBeChecked();
    expect(screen.getByLabelText("Batch size")).toBeDisabled();
    expect(screen.getByRole("link", { name: "Create dataset" })).toHaveAttribute(
      "href",
      "/models/datasets?new=1",
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
      dataset_id: exampleTrainable.id,
      base_model_id: exampleModel.id,
      epochs: 3,
      imgsz: 1280,
      batch: 8,
      patience: 50,
      augmentation: "aerial",
      device: "0",
    });
  });

  it("folds the training settings under More options and names the changed ones when folded", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <TrainForm
        datasets={[exampleTrainable]}
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
    const toggle = screen.getByRole("button", { name: "More options" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Epochs")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText("Epochs"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /More options/ }));
    expect(screen.getByRole("button", { name: /More options/ })).toHaveTextContent("Changed: epochs");
    // An invalid folded setting opens the fold again next to the message.
    fireEvent.click(screen.getByRole("button", { name: "Start training" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Epochs must be a whole number");
    expect(screen.getByLabelText("Epochs")).toHaveValue(0);
  });

  it("preselects the dataset named by initialDatasetId over the newest one", () => {
    const older = { ...exampleTrainable, id: "older-dataset", name: "v0" };
    const { api } = fakeClient([]);
    renderWithProviders(
      <TrainForm
        datasets={[exampleTrainable, older]}
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

  it("keeps a name the user cleared when the lists arrive again", () => {
    const { api } = fakeClient([]);
    const form = (datasets: (typeof exampleTrainable)[], models: (typeof exampleModel)[]) => (
      <TrainForm
        datasets={datasets}
        models={models}
        datasetsUnavailable={false}
        modelsUnavailable={false}
        modelsLoading={false}
        modelsError={null}
        busy={false}
        onStart={vi.fn()}
      />
    );
    const { rerender } = renderWithProviders(form([exampleTrainable], [exampleModel]), { api });
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "" } });
    // A refetch hands the form new arrays with the same content (the Train screen polls them).
    rerender(
      <TestApiProvider api={api}>
        <MemoryRouter>{form([{ ...exampleTrainable }], [{ ...exampleModel }])}</MemoryRouter>
      </TestApiProvider>,
    );
    expect(screen.getByLabelText("Model name")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Start training" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Give the model a name.");
  });

  it("points to a starter model when the registry has loaded, is available and empty", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <TrainForm
        datasets={[exampleTrainable]}
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
    expect(screen.queryByText(/Any model in your library, including starter models/)).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Add a starter model" });
    expect(link).toHaveAttribute("href", "/models/library");
  });

  it("shows the usual base model help text once the registry has a model", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <TrainForm
        datasets={[exampleTrainable]}
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
    expect(screen.getByText(/Any model in your library, including starter models/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add a starter model" })).not.toBeInTheDocument();
  });

  it("does not offer a starter model while the registry is still loading", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <TrainForm
        datasets={[exampleTrainable]}
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
        datasets={[exampleTrainable]}
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
    // The "no model of this task" notice would misleadingly imply an empty library; the
    // "library could not be opened" warning already covers this state.
    expect(
      screen.queryByText(/No .* model in the library yet\. Add a? .*starter under Library\./),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add a starter model" })).not.toBeInTheDocument();
  });

  it("does not offer a starter model while the registry failed to load", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <TrainForm
        datasets={[exampleTrainable]}
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
    expect(screen.queryByText(/model in the library yet/)).not.toBeInTheDocument();
  });

  it("explains the parameters and warns about a dataset too small to learn from", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <TrainForm
        datasets={[{ ...exampleTrainable, image_count: 14, train_count: 8, val_count: 6 }]}
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
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByText(/Passes over the training images/)).toBeInTheDocument();
    expect(screen.getByText(/1280 keeps small machines visible/)).toBeInTheDocument();
    expect(screen.getByText(/Stops early after this many epochs without improvement/)).toBeInTheDocument();
    // The warning informs; it does not block a deliberate smoke test.
    expect(screen.getByRole("button", { name: "Start training" })).toBeEnabled();
  });

  it("disables models whose file is missing and does not preselect them", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <TrainForm
        datasets={[exampleTrainable]}
        models={[{ ...exampleModel, state: "unavailable" }, exampleTrainedModel]}
        datasetsUnavailable={false}
        modelsUnavailable={false}
        modelsLoading={false}
        modelsError={null}
        busy={false}
        onStart={() => {}}
      />,
      { api },
    );
    expect(screen.getByRole("option", { name: /yolo11m-coco .* \(file missing\)$/ })).toBeDisabled();
    expect(screen.getByLabelText("Base model")).toHaveValue(exampleTrainedModel.id);
  });

  it("disables Start while another run is preparing the chosen dataset, and says why", () => {
    const { api } = fakeClient([]);
    const onStart = vi.fn();
    renderWithProviders(
      <TrainForm
        datasets={[{ ...exampleTrainable, exportBusy: true }]}
        models={[exampleModel]}
        datasetsUnavailable={false}
        modelsUnavailable={false}
        modelsLoading={false}
        modelsError={null}
        busy={false}
        onStart={onStart}
      />,
      { api },
    );
    const start = screen.getByRole("button", { name: "Start training" });
    expect(start).toBeDisabled();
    expect(start).toHaveAccessibleDescription(
      "Another run is preparing this dataset; start when it has finished.",
    );
    fireEvent.submit(start.closest("form")!);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("lists only base models of the dataset's task", () => {
    const { api } = fakeClient([]);
    const detect = { ...exampleModel, id: "m-det", name: "coco-det", task: "detect" as const };
    const seg = { ...exampleModel, id: "m-seg", name: "coco-seg", task: "segment" as const };
    const boxes = { ...exampleTrainable, id: "d-box", name: "machines", task: "detect" as const };
    const polys = { ...exampleTrainable, id: "d-poly", name: "cracks", task: "segment" as const };
    renderWithProviders(
      <TrainForm
        datasets={[boxes, polys]}
        models={[detect, seg]}
        datasetsUnavailable={false}
        modelsUnavailable={false}
        modelsLoading={false}
        modelsError={null}
        busy={false}
        onStart={() => {}}
      />,
      { api },
    );
    const model = screen.getByLabelText("Base model");
    expect(within(model).queryByRole("option", { name: /coco-seg/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Dataset"), { target: { value: "d-poly" } });
    expect(within(model).getByRole("option", { name: /coco-seg/ })).toBeInTheDocument();
    expect(within(model).queryByRole("option", { name: /coco-det/ })).not.toBeInTheDocument();
    expect(model).toHaveValue("m-seg");
  });

  it("says when the library has no model of the dataset's task", () => {
    const { api } = fakeClient([]);
    const polys = { ...exampleTrainable, id: "d-poly", task: "segment" as const };
    renderWithProviders(
      <TrainForm
        datasets={[polys]}
        models={[{ ...exampleModel, task: "detect" as const }]}
        datasetsUnavailable={false}
        modelsUnavailable={false}
        modelsLoading={false}
        modelsError={null}
        busy={false}
        onStart={() => {}}
      />,
      { api },
    );
    expect(
      screen.getByText("No polygon model in the library yet. Add a segmentation starter under Library."),
    ).toBeInTheDocument();
  });
});
