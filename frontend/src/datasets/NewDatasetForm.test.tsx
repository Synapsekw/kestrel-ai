import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { errorBody, exampleDataset, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { NewDatasetForm } from "./NewDatasetForm";

describe("NewDatasetForm", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("posts name, split, fraction and seed without image_ids, then shows the job", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/datasets$/,
        status: 202,
        body: { dataset: exampleDataset, job: { ...runningJob, type: "dataset" } },
      },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: { ...runningJob, type: "dataset" } },
    ]);
    renderWithProviders(<NewDatasetForm projectId={PROJECT_ID} onClose={vi.fn()} />, { api });
    fireEvent.change(screen.getByLabelText("Dataset name"), { target: { value: "v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Split options" }));
    fireEvent.change(screen.getByLabelText("Split method"), { target: { value: "random" } });
    fireEvent.change(screen.getByLabelText("Validation fraction"), { target: { value: "0.3" } });
    fireEvent.change(screen.getByLabelText("Seed"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));
    await waitFor(() => expect(screen.getByTestId(`job-${runningJob.id}`)).toBeInTheDocument());
    expect(requests[0].body).toEqual({ name: "v2", split_method: "random", val_fraction: 0.3, seed: 7 });
  });

  it("refuses a name with a space before sending, without a native pattern attribute", async () => {
    const { api, requests } = fakeClient([]);
    renderWithProviders(<NewDatasetForm projectId={PROJECT_ID} onClose={vi.fn()} />, { api });
    const nameInput = screen.getByLabelText("Dataset name");
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

  it("shows the nothing-to-train-on 409 message", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/datasets$/,
        status: 409,
        body: errorBody("conflict", "Nothing to train on: the selection has no accepted boxes."),
      },
    ]);
    renderWithProviders(<NewDatasetForm projectId={PROJECT_ID} onClose={vi.fn()} />, { api });
    fireEvent.change(screen.getByLabelText("Dataset name"), { target: { value: "v1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Nothing to train on"));
  });

  it("keeps the split options folded away until asked, with the defaults", () => {
    const { api } = fakeClient([]);
    renderWithProviders(<NewDatasetForm projectId={PROJECT_ID} onClose={vi.fn()} />, { api });
    const toggle = screen.getByRole("button", { name: "Split options" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Split method")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByLabelText("Split method")).toHaveValue("by_group");
    expect(screen.getByLabelText("Validation fraction")).toHaveValue(0.2);
    expect(screen.getByLabelText("Seed")).toHaveValue(42);
  });

  it("closes on Cancel", () => {
    const { api } = fakeClient([]);
    const onClose = vi.fn();
    renderWithProviders(<NewDatasetForm projectId={PROJECT_ID} onClose={onClose} />, { api });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says a frozen dataset widens a rotated box to its upright envelope", () => {
    const { api } = fakeClient([]);
    renderWithProviders(<NewDatasetForm projectId={PROJECT_ID} onClose={vi.fn()} />, { api });
    expect(screen.getByText(/rotated box is widened/i)).toBeInTheDocument();
  });
});
