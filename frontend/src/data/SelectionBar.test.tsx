import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { exampleJob, fakeClient, PROJECT_ID, MODEL_ID, errorBody } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { SelectionBar } from "./SelectionBar";

describe("SelectionBar", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("runs the model, creates a dataset and deletes after confirmation", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/query-runs$/,
        status: 202,
        body: { query_run: { id: "q" }, job: exampleJob },
      },
      {
        method: "POST",
        path: /\/datasets$/,
        status: 202,
        body: { dataset: { id: "d" }, job: { ...exampleJob, id: "j2" } },
      },
      { method: "POST", path: /\/images\/bulk-delete$/, body: { deleted: 2 } },
    ]);
    const onDeleted = vi.fn();
    const onLabel = vi.fn();
    renderWithProviders(
      <SelectionBar
        projectId={PROJECT_ID}
        selectedIds={["a", "b"]}
        preannotationModelId={MODEL_ID}
        onLabel={onLabel}
        onDeleted={onDeleted}
        onClear={() => {}}
      />,
      { api },
    );
    fireEvent.click(screen.getByRole("button", { name: "Label selected" }));
    expect(onLabel).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Run model" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Model run queued"));
    expect(Object.keys(useJobsStore.getState().jobs)).toEqual([exampleJob.id]);

    fireEvent.click(screen.getByRole("button", { name: "Add to dataset" }));
    fireEvent.change(screen.getByLabelText("Dataset name"), { target: { value: "v1" } });
    fireEvent.change(screen.getByLabelText("Split method"), { target: { value: "random" } });
    fireEvent.change(screen.getByLabelText("Validation fraction"), { target: { value: "0.3" } });
    fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Dataset v1 queued"));
    expect(requests[1].body).toEqual({
      name: "v1",
      split_method: "random",
      val_fraction: 0.3,
      seed: 42,
      image_ids: ["a", "b"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 images" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(requests[2].body).toEqual({ image_ids: ["a", "b"] });
  });

  it("disables Run model without a pre-annotation model and shows the envelope message on failure", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/datasets$/,
        status: 501,
        body: errorBody("not_implemented", "datasets arrive with S1"),
      },
    ]);
    renderWithProviders(
      <SelectionBar
        projectId={PROJECT_ID}
        selectedIds={["a"]}
        preannotationModelId={null}
        onLabel={() => {}}
        onDeleted={() => {}}
        onClear={() => {}}
      />,
      { api },
    );
    expect(screen.getByRole("button", { name: "Run model" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add to dataset" }));
    fireEvent.change(screen.getByLabelText("Dataset name"), { target: { value: "v1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("datasets arrive with S1"));
  });
});
