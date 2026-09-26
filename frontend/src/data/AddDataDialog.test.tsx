import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AddDataHost } from "@/app/AddDataHost";
import { useAddData } from "@/app/addDataStore";
import { useChangesStore } from "@/store/changes";
import { useToastStore } from "@/ui";
import { AddDataDialog } from "./AddDataDialog";
import { openAddData, useAddDataReady } from "./addDataTiles";

// The importers have their own tests; here each is a stub that can report "started".
// Hoisted with the mocks, which run before the module body.
const { stub } = vi.hoisted(() => ({
  stub:
    (name: string) =>
    ({ onStarted }: { onStarted: () => void }) => (
      <div role="dialog" aria-label={name}>
        <button type="button" onClick={() => onStarted()}>
          Start {name}
        </button>
      </div>
    ),
}));
vi.mock("./ImportImagesDialog", () => ({ ImportImagesDialog: stub("Import images") }));
vi.mock("@/maps/ImportMapDialog", () => ({ ImportMapDialog: stub("Import map") }));
vi.mock("@/clouds/ImportCloudDialog", () => ({ ImportCloudDialog: stub("Import cloud") }));
vi.mock("@/surfaces/ImportElevationDialog", () => ({ ImportElevationDialog: stub("Add elevation") }));

describe("AddDataDialog", () => {
  beforeEach(() => {
    useChangesStore.setState({ dataRevision: 0 });
    useToastStore.getState().clear();
    useAddData.setState({ open: false, tile: null, projectId: null });
  });

  it("offers five tiles, with Drawing disabled until the Maps workspace", () => {
    const { api } = fakeClient([]);
    renderWithProviders(<AddDataDialog project={exampleProject} onClose={() => {}} />, { api });
    const dialog = screen.getByRole("dialog", { name: "Add data" });
    for (const name of [/Photos/, /Orthomosaic/, /Elevation/, /Point cloud/]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    expect(screen.getByRole("button", { name: /Drawing/ })).toHaveAttribute("aria-disabled", "true");
    expect(dialog).toHaveTextContent("Arrives with the Maps workspace");
  });

  it("closes when the photo import is queued, and says it runs in the background", () => {
    const onClose = vi.fn();
    const { api } = fakeClient([]);
    renderWithProviders(<AddDataDialog project={exampleProject} onClose={onClose} />, { api });
    fireEvent.click(screen.getByRole("button", { name: /Photos/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start Import images" }));
    expect(onClose).toHaveBeenCalled();
    expect(useChangesStore.getState().dataRevision).toBe(1);
    expect(useToastStore.getState().toasts.at(-1)?.text).toMatch(/Photos import started/);
  });

  it.each([
    [/Orthomosaic/, "Start Import map"],
    [/Elevation/, "Start Add elevation"],
    [/Point cloud/, "Start Import cloud"],
  ])("routes %s to its importer", (tile, start) => {
    const onClose = vi.fn();
    const { api } = fakeClient([]);
    renderWithProviders(<AddDataDialog project={exampleProject} onClose={onClose} />, { api });
    fireEvent.click(screen.getByRole("button", { name: tile }));
    fireEvent.click(screen.getByRole("button", { name: start }));
    expect(onClose).toHaveBeenCalled();
  });

  it("the host opens straight on a tile from the store (palette, empty states) and closes it", async () => {
    const { api } = fakeClient([]);
    renderWithProviders(<AddDataHost project={exampleProject} />, { api });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openAddData("orthomosaic"));
    fireEvent.click(await screen.findByRole("button", { name: "Start Import map" }));
    await waitFor(() => expect(useAddData.getState().open).toBe(false));
  });

  it("does nothing until the shell has loaded a project, then reports ready for that project only", () => {
    const { result, rerender } = renderHook(({ id }) => useAddDataReady(id), {
      initialProps: { id: PROJECT_ID },
    });
    openAddData("photos");
    expect(useAddData.getState().open).toBe(false);
    expect(result.current).toBe(false);
    act(() => useAddData.getState().setProject(PROJECT_ID));
    expect(result.current).toBe(true);
    rerender({ id: "p-other" });
    expect(result.current).toBe(false);
    openAddData("photos");
    expect(useAddData.getState()).toMatchObject({ open: true, tile: "photos" });
  });
});
