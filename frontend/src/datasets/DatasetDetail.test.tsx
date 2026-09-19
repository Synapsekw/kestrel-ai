import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { errorBody, exampleDataset, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { DatasetDetail } from "./DatasetDetail";

const STATS = {
  image_count: 30,
  train_count: 24,
  val_count: 6,
  boxes_per_class: [
    { class_id: "c1", class_name: "excavator", train: 20, val: 5 },
    { class_id: "c2", class_name: "crane", train: 0, val: 0 },
  ],
  groups: [
    { group_key: "0031", split: "train", image_count: 24 },
    { group_key: "0033", split: "val", image_count: 6 },
  ],
};

describe("DatasetDetail", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("shows per-class and group stats, the folder, and a link to train on it", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/stats$/, body: STATS }]);
    renderWithProviders(
      <DatasetDetail projectId={PROJECT_ID} dataset={exampleDataset} onDeleted={vi.fn()} />,
      {
        api,
      },
    );
    const classStats = await screen.findByTestId("dataset-class-stats");
    expect(classStats).toHaveTextContent("excavator");
    expect(classStats).toHaveTextContent("20");
    expect(classStats).toHaveTextContent("crane");
    const groupStats = screen.getByTestId("dataset-group-stats");
    expect(groupStats).toHaveTextContent("0031");
    expect(groupStats).toHaveTextContent("train");
    expect(screen.getByText(exampleDataset.path)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Train on this dataset" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/train?dataset=${exampleDataset.id}`,
    );
  });

  it("shows the split advice as a note, not an alert, when there is one (M3)", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/stats$/, body: STATS }]);
    const risky = { ...exampleDataset, image_count: 14, train_count: 8, val_count: 6 };
    renderWithProviders(<DatasetDetail projectId={PROJECT_ID} dataset={risky} onDeleted={vi.fn()} />, {
      api,
    });
    const advice = await screen.findByRole("note");
    expect(advice).toHaveTextContent(/went to validation although/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows Loading… before the stats arrive (M4)", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/stats$/, body: STATS }]);
    renderWithProviders(
      <DatasetDetail projectId={PROJECT_ID} dataset={exampleDataset} onDeleted={vi.fn()} />,
      { api },
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await screen.findByTestId("dataset-class-stats");
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("asks for confirmation, deletes, and reports a 409 conflict as an alert", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/stats$/, body: STATS },
      {
        method: "DELETE",
        path: /\/datasets\/[^/]+$/,
        status: 409,
        body: errorBody("conflict", "dataset 'v1' is in use by a running job"),
      },
    ]);
    const onDeleted = vi.fn();
    renderWithProviders(
      <DatasetDetail projectId={PROJECT_ID} dataset={exampleDataset} onDeleted={onDeleted} />,
      {
        api,
      },
    );
    await screen.findByTestId("dataset-class-stats");
    fireEvent.click(screen.getByRole("button", { name: "Delete dataset" }));
    expect(screen.getByText(/Delete dataset v1\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() =>
      expect(screen.getByText("dataset 'v1' is in use by a running job")).toBeInTheDocument(),
    );
    expect(requests.some((r) => r.method === "DELETE")).toBe(true);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("deletes successfully and calls onDeleted", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/stats$/, body: STATS },
      { method: "DELETE", path: /\/datasets\/[^/]+$/, status: 204 },
    ]);
    const onDeleted = vi.fn();
    renderWithProviders(
      <DatasetDetail projectId={PROJECT_ID} dataset={exampleDataset} onDeleted={onDeleted} />,
      {
        api,
      },
    );
    await screen.findByTestId("dataset-class-stats");
    fireEvent.click(screen.getByRole("button", { name: "Delete dataset" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(exampleDataset.id));
  });

  it("shows 'being written…' while the materialise job is active, and hides the Train link (M5e)", async () => {
    useJobsStore
      .getState()
      .upsert({ ...runningJob, id: exampleDataset.job_id!, type: "dataset", state: "running" });
    const { api } = fakeClient([{ method: "GET", path: /\/stats$/, body: STATS }]);
    renderWithProviders(
      <DatasetDetail projectId={PROJECT_ID} dataset={exampleDataset} onDeleted={vi.fn()} />,
      { api },
    );
    expect(await screen.findByText(/being written/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Train on this dataset" })).not.toBeInTheDocument();
  });

  it("shows 'incomplete' when the materialise job failed, and hides the Train link (M5e)", async () => {
    useJobsStore
      .getState()
      .upsert({ ...runningJob, id: exampleDataset.job_id!, type: "dataset", state: "failed" });
    const { api } = fakeClient([{ method: "GET", path: /\/stats$/, body: STATS }]);
    renderWithProviders(
      <DatasetDetail projectId={PROJECT_ID} dataset={exampleDataset} onDeleted={vi.fn()} />,
      { api },
    );
    expect(await screen.findByText(/incomplete/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Train on this dataset" })).not.toBeInTheDocument();
  });
});
