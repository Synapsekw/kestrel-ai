import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { exampleImagePage, exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { DataManagerScreen } from "@/screens/DataManagerScreen";

/** The grid is rendered through the Data Manager so J/K and selection use the real key handling. */
function renderGrid() {
  const { api } = fakeClient([
    { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
    { method: "GET", path: /\/images$/, body: exampleImagePage },
    { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
  ]);
  renderWithProviders(
    <Routes>
      <Route path="/p/:projectId/data" element={<DataManagerScreen />} />
      <Route path="/p/:projectId/edit/:imageId" element={<p>editor route</p>} />
    </Routes>,
    { api, route: `/p/${PROJECT_ID}/data` },
  );
}

const current = () =>
  screen.getAllByRole("listitem").filter((c) => c.getAttribute("aria-current") === "true");

describe("ImageGrid", () => {
  beforeEach(() => useChangesStore.setState({ imagesRevision: 0, boxesRevision: {} }));

  it("is a list of items where exactly one cell is current and J moves it", async () => {
    renderGrid();
    const grid = await screen.findByRole("list", { name: "Images" });
    await waitFor(() => expect(within(grid).getAllByRole("listitem")).toHaveLength(2));
    const cells = within(grid).getAllByRole("listitem");
    expect(current()).toEqual([cells[0]]);
    expect(grid).toHaveAttribute("data-testid", "image-grid");

    fireEvent.keyDown(grid, { key: "j" });
    expect(current()).toEqual([within(grid).getAllByRole("listitem")[1]]);
    fireEvent.keyDown(grid, { key: "j" });
    expect(current()).toHaveLength(1);
    fireEvent.keyDown(grid, { key: "k" });
    expect(current()).toEqual([within(grid).getAllByRole("listitem")[0]]);
  });

  it("keeps a real checkbox per cell that toggles the selection without opening the image", async () => {
    renderGrid();
    const grid = await screen.findByRole("list", { name: "Images" });
    await waitFor(() => expect(within(grid).getAllByRole("listitem")).toHaveLength(2));
    const box = within(grid).getByRole("checkbox", { name: "Select IX-12-02491_0031_0001.jpg" });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(box).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.queryByText("editor route")).not.toBeInTheDocument();
    fireEvent.click(box);
    expect(box).not.toBeChecked();
    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();

    fireEvent.keyDown(grid, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("editor route")).toBeInTheDocument());
  });
});
