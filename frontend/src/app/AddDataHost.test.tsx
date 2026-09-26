import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AddDataHost } from "./AddDataHost";
import { useAddData } from "./addDataStore";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderHost() {
  renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <AddDataHost project={exampleProject} />
            <Where />
          </>
        }
      />
    </Routes>,
    { api: fakeClient([]).api, route: `/p/${PROJECT_ID}/overview` },
  );
}

describe("AddDataHost", () => {
  beforeEach(() => useAddData.setState({ open: false, tile: null }));

  it("renders nothing until opened", () => {
    renderHost();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers five kinds of data, Drawing not yet", () => {
    renderHost();
    act(() => useAddData.getState().show(null));
    const dialog = screen.getByRole("dialog", { name: "Add data" });
    for (const name of [/Photos/, /Orthomosaic/, /Elevation/, /Point cloud/]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    expect(screen.getByRole("button", { name: /Drawing/ })).toBeDisabled();
    expect(dialog).toBeInTheDocument();
  });

  it("opens the photo importer from Photos", () => {
    renderHost();
    act(() => useAddData.getState().show(null));
    fireEvent.click(screen.getByRole("button", { name: /Photos/ }));
    expect(screen.getByRole("dialog", { name: "Import images" })).toBeInTheDocument();
  });

  it("opens an importer directly when asked for one", () => {
    renderHost();
    act(() => useAddData.getState().show("orthomosaic"));
    expect(screen.queryByRole("dialog", { name: "Add data" })).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("takes Point cloud and Elevation to the screens that import them", () => {
    renderHost();
    act(() => useAddData.getState().show(null));
    fireEvent.click(screen.getByRole("button", { name: /Point cloud/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(`/p/${PROJECT_ID}/clouds`);
    expect(useAddData.getState().open).toBe(false);
    act(() => useAddData.getState().show(null));
    fireEvent.click(screen.getByRole("button", { name: /Elevation/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(`/p/${PROJECT_ID}/measurements`);
  });
});
