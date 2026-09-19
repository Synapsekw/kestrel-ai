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
    <SelectionBar projectId={PROJECT_ID} selectedIds={["a", "b"]} emptyCount={0} {...handlers} {...props} />,
    { api },
  );
  return handlers;
}

describe("SelectionBar", () => {
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

  it("marks the selection empty and reports skipped images with accepted boxes", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/images\/bulk-mark-empty$/, body: { updated: 1, skipped: 1 } },
    ]);
    const h = renderBar(api);
    fireEvent.click(screen.getByRole("button", { name: "Mark as empty" }));
    await waitFor(() =>
      expect(h.onMarked).toHaveBeenCalledWith(
        "1 marked as empty, 1 skipped because they have accepted boxes",
      ),
    );
    expect(requests[0]).toMatchObject({ body: { image_ids: ["a", "b"], marked_empty: true } });
  });

  it("marks the selection empty with no skipped note when nothing was skipped", async () => {
    const { api } = fakeClient([
      { method: "POST", path: /\/images\/bulk-mark-empty$/, body: { updated: 2, skipped: 0 } },
    ]);
    const h = renderBar(api);
    fireEvent.click(screen.getByRole("button", { name: "Mark as empty" }));
    await waitFor(() => expect(h.onMarked).toHaveBeenCalledWith("2 marked as empty"));
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
