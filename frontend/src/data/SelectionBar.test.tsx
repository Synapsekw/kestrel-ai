import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { SelectionBar } from "./SelectionBar";

function renderBar(
  api: ReturnType<typeof fakeClient>["api"],
  props: Partial<Parameters<typeof SelectionBar>[0]> = {},
) {
  const handlers = {
    onLabel: vi.fn(),
    onRunModel: vi.fn(),
    onDeleted: vi.fn(),
    onMarked: vi.fn(),
    onClear: vi.fn(),
  };
  renderWithProviders(
    <SelectionBar
      projectId={PROJECT_ID}
      selectedIds={["a", "b"]}
      labeledCount={0}
      emptyCount={0}
      unlabeledCount={2}
      pendingCount={0}
      {...handlers}
      {...props}
    />,
    { api },
  );
  return handlers;
}

describe("SelectionBar", () => {
  it("offers only its own kind's actions: no Run model in training, no datasets in detection", () => {
    const { api } = fakeClient([]);
    renderBar(api, { kind: "train" });
    expect(screen.queryByRole("button", { name: "Run model" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add to dataset" })).toBeInTheDocument();
  });

  it("a detection project's selection runs a model and never builds a dataset", () => {
    const { api } = fakeClient([]);
    renderBar(api, { kind: "detect" });
    expect(screen.getByRole("button", { name: "Run model" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to dataset" })).toBeNull();
  });

  it("hands label and run-model to the screen, opens the dataset dialog and deletes after confirmation", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/images\/bulk-delete$/, body: { deleted: 2 } },
    ]);
    const h = renderBar(api);
    fireEvent.click(screen.getByRole("button", { name: "Label selected" }));
    expect(h.onLabel).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run model" }));
    expect(h.onRunModel).toHaveBeenCalled();
    expect(requests).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Add to dataset" }));
    expect(screen.getByRole("dialog", { name: "Add to dataset" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 images" }));
    await waitFor(() => expect(h.onDeleted).toHaveBeenCalledWith("2 images deleted"));
    expect(requests[0].body).toEqual({ image_ids: ["a", "b"] });
  });

  it("confirms before marking, mentioning pending suggestions, and reports skipped images (I2b)", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/images\/bulk-mark-empty$/, body: { updated: 1, skipped: 1 } },
    ]);
    const h = renderBar(api, { pendingCount: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Mark as empty" }));
    expect(requests).toHaveLength(0); // asks first, like Delete
    expect(
      screen.getByText("Mark 2 images as empty? 3 pending suggestions on them will be rejected."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark 2 as empty" }));
    await waitFor(() =>
      expect(h.onMarked).toHaveBeenCalledWith(
        "1 marked as empty, 1 skipped because they have accepted boxes",
      ),
    );
    expect(requests[0]).toMatchObject({ body: { image_ids: ["a", "b"], marked_empty: true } });
  });

  it("omits the pending-suggestions sentence when nothing is pending, and can be cancelled", async () => {
    const { api } = fakeClient([
      { method: "POST", path: /\/images\/bulk-mark-empty$/, body: { updated: 2, skipped: 0 } },
    ]);
    const h = renderBar(api, { pendingCount: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Mark as empty" }));
    expect(screen.getByText("Mark 2 images as empty?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Mark 2 images as empty/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mark as empty" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark 2 as empty" }));
    await waitFor(() => expect(h.onMarked).toHaveBeenCalledWith("2 marked as empty"));
  });

  it("mentions already-marked images in the result, computed from the selection (M10)", async () => {
    const { api } = fakeClient([
      { method: "POST", path: /\/images\/bulk-mark-empty$/, body: { updated: 1, skipped: 0 } },
    ]);
    const h = renderBar(api, { emptyCount: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Mark as empty" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark 2 as empty" }));
    await waitFor(() => expect(h.onMarked).toHaveBeenCalledWith("1 marked as empty, 1 already marked"));
  });

  it("offers Unmark empty with no confirmation when the selection has marked images (I2b)", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/images\/bulk-mark-empty$/, body: { updated: 2, skipped: 0 } },
    ]);
    const h = renderBar(api, { emptyCount: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Unmark empty" }));
    await waitFor(() => expect(h.onMarked).toHaveBeenCalledWith("2 no longer marked empty"));
    expect(requests[0]).toMatchObject({ body: { image_ids: ["a", "b"], marked_empty: false } });
  });

  it("does not offer Unmark empty when nothing in the selection is marked", () => {
    const { api } = fakeClient([]);
    renderBar(api, { emptyCount: 0 });
    expect(screen.queryByRole("button", { name: "Unmark empty" })).not.toBeInTheDocument();
  });

  it("shows the envelope message when a delete fails", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/images\/bulk-delete$/,
        status: 500,
        body: { error: { code: "internal_error", message: "disk full", details: {} } },
      },
    ]);
    renderBar(api, { selectedIds: ["a"] });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete 1 images" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("disk full"));
  });
});
