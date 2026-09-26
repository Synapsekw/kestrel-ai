import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import type { Project } from "@contract/client";
import { exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AddDataHost } from "./AddDataHost";
import { useAddData } from "./addDataStore";

// The dialog's tiles and importer routing are pinned by data/AddDataDialog.test.tsx.

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

  it("renders nothing until opened, then the Add data dialog", () => {
    renderWithProviders(<AddDataHost project={exampleProject} />, {
      api: fakeClient([]).api,
      route: `/p/${PROJECT_ID}/overview`,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => useAddData.getState().show(null));
    expect(screen.getByRole("dialog", { name: "Add data" })).toBeInTheDocument();
  });

  it("renders nothing while the project is loading", () => {
    renderWithProviders(<AddDataHost project={null} />, { api: fakeClient([]).api });
    act(() => useAddData.setState({ open: true, tile: null }));
    expect(screen.queryByRole("dialog")).toBeNull();
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
