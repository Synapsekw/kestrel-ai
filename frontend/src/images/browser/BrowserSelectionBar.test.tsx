import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useChangesStore } from "@/store/changes";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { BrowserSelectionBar } from "./BrowserSelectionBar";

const sel = (ids: string[]) => ({ selected: new Set(ids), anchor: ids[0] ?? null });

function renderBar(ids: string[], onDetect?: (ids: string[]) => void) {
  const { api, requests } = fakeClient([
    { method: "POST", path: /bulk-mark-empty$/, body: { updated: 2, skipped: 1 } },
    { method: "POST", path: /bulk-delete$/, body: { deleted: ids.length } },
  ]);
  const onSelectionChange = vi.fn();
  renderWithProviders(
    <BrowserSelectionBar
      projectId={PROJECT_ID}
      selection={sel(ids)}
      onSelectionChange={onSelectionChange}
      onDetect={onDetect}
    />,
    { api },
  );
  return { requests, onSelectionChange };
}

describe("BrowserSelectionBar", () => {
  beforeEach(() => useChangesStore.setState({ imagesRevision: 0 }));

  it("is absent with nothing selected", () => {
    const { api } = fakeClient([]);
    const { container } = renderWithProviders(
      <BrowserSelectionBar projectId={PROJECT_ID} selection={sel([])} onSelectionChange={() => {}} />,
      { api },
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("detect on selection hands the ids to the host", () => {
    const onDetect = vi.fn();
    renderBar(["a", "b"], onDetect);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Detect on selection" }));
    expect(onDetect).toHaveBeenCalledWith(["a", "b"]);
  });

  it("nothing to report marks the images empty and refreshes the index", async () => {
    const { requests } = renderBar(["a", "b", "c"]);
    fireEvent.click(screen.getByRole("button", { name: "Nothing to report" }));
    await waitFor(() => expect(useChangesStore.getState().imagesRevision).toBe(1));
    expect(requests[0].body).toEqual({ image_ids: ["a", "b", "c"], marked_empty: true });
  });

  it("delete asks first, then deletes and clears the selection", async () => {
    const { requests, onSelectionChange } = renderBar(["a"]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(requests).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Delete 1 image" }));
    await waitFor(() =>
      expect(onSelectionChange).toHaveBeenCalledWith({ selected: new Set(), anchor: null }),
    );
    expect(requests[0].body).toEqual({ image_ids: ["a"] });
    expect(useChangesStore.getState().imagesRevision).toBe(1);
  });
});
