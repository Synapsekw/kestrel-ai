import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import type { Project } from "@contract/client";
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

/** The host under a shell whose project can change (another project, or one still loading). */
function SwitchingHost() {
  const [project, setProject] = useState<Project | null>(exampleProject);
  return (
    <>
      <AddDataHost project={project} />
      <button type="button" onClick={() => setProject({ ...exampleProject, id: "p-other" })}>
        other project
      </button>
      <button type="button" onClick={() => setProject(null)}>
        loading
      </button>
    </>
  );
}

describe("AddDataHost", () => {
  beforeEach(() => useAddData.setState({ open: false, tile: null, projectId: null }));

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

  it("publishes the loaded project and closes when the project changes, so it never follows into another", () => {
    renderWithProviders(<SwitchingHost />, { api: fakeClient([]).api, route: `/p/${PROJECT_ID}/overview` });
    expect(useAddData.getState().projectId).toBe(PROJECT_ID);
    act(() => useAddData.getState().show(null));
    fireEvent.click(screen.getByRole("button", { name: "other project" }));
    expect(useAddData.getState()).toMatchObject({ open: false, projectId: "p-other" });
    act(() => useAddData.getState().show("photos"));
    fireEvent.click(screen.getByRole("button", { name: "loading" }));
    expect(useAddData.getState()).toMatchObject({ open: false, projectId: null });
  });
});
