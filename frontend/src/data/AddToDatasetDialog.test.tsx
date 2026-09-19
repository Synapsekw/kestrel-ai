import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { errorBody, exampleDataset, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { AddToDatasetDialog } from "./AddToDatasetDialog";

describe("AddToDatasetDialog", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("creates the dataset with name, split, fraction and seed, then shows the job", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/datasets$/,
        status: 202,
        body: { dataset: exampleDataset, job: { ...runningJob, type: "dataset" } },
      },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: { ...runningJob, type: "dataset" } },
    ]);
    const onClose = vi.fn();
    renderWithProviders(
      <AddToDatasetDialog projectId={PROJECT_ID} imageIds={["a", "b"]} onClose={onClose} />,
      { api },
    );
    expect(screen.getByRole("dialog", { name: "Add to dataset" })).toHaveTextContent("2 images");
    expect(screen.getByLabelText("Seed")).toHaveValue(42);
    fireEvent.change(screen.getByLabelText("Dataset name"), { target: { value: "v2" } });
    fireEvent.change(screen.getByLabelText("Split method"), { target: { value: "random" } });
    fireEvent.change(screen.getByLabelText("Validation fraction"), { target: { value: "0.3" } });
    fireEvent.change(screen.getByLabelText("Seed"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));
    await waitFor(() => expect(screen.getByTestId(`job-${runningJob.id}`)).toBeInTheDocument());
    expect(requests[0].body).toEqual({
      name: "v2",
      split_method: "random",
      val_fraction: 0.3,
      seed: 7,
      image_ids: ["a", "b"],
    });
    expect(useJobsStore.getState().jobs[runningJob.id].type).toBe("dataset");
    expect(screen.getByRole("link", { name: "Train on it" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/train`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the envelope message on failure", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/datasets$/,
        status: 409,
        body: errorBody("already_exists", "dataset v1 exists"),
      },
    ]);
    renderWithProviders(<AddToDatasetDialog projectId={PROJECT_ID} imageIds={["a"]} onClose={() => {}} />, {
      api,
    });
    fireEvent.change(screen.getByLabelText("Dataset name"), { target: { value: "v1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("dataset v1 exists"));
  });

  it("refuses a name with a space before sending and says which characters are allowed", async () => {
    const { api, requests } = fakeClient([]);
    renderWithProviders(<AddToDatasetDialog projectId={PROJECT_ID} imageIds={["a"]} onClose={() => {}} />, {
      api,
    });
    const nameInput = screen.getByLabelText("Dataset name");
    // `[A-Za-z0-9._-]+` is not a valid `pattern` under the v flag WebView2 compiles it with.
    expect(nameInput).not.toHaveAttribute("pattern");
    expect(screen.getByText("Letters, digits, dot, dash and underscore; no spaces.")).toBeInTheDocument();
    fireEvent.change(nameInput, { target: { value: "first set" } });
    fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The name may only contain letters, digits, dot, dash and underscore (no spaces).",
      ),
    );
    expect(requests).toHaveLength(0);
  });
});
