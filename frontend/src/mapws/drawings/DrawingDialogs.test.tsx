import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAddData } from "@/app/addDataStore";
import { LayerRowView } from "@/mapws/chrome/LayerRowView";
import type { LayerRow } from "@/mapws/layers/layerRegistry";
import drawingDialogsPanel from "@/mapws/panels/drawingDialogs.panel";
import { useGoneLayers } from "@/mapws/layers/goneLayers";
import { makeStores, renderInWorkspace } from "@/mapws/test/harness";
import alignDrawing from "@/mapws/tools/alignDrawing.tool";
import selectTool from "@/mapws/tools/select.tool";
import { useChangesStore } from "@/store/changes";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { ALIGN_TOOL_ID } from "./AlignOverlay";
import { DrawingDialogs } from "./DrawingDialogs";
import { drawingRowMenu } from "./drawingRows";
import { useDrawingUi } from "./drawingUi";
import { useDrawingsStore } from "./drawingsStore";
import { takeImportPrefill } from "./importPrefill";
import { pdfDrawing, SITE_FRAME } from "./testFixtures";

function show(routes: Parameters<typeof fakeClient>[0] = [], extra?: ReactNode) {
  const stores = makeStores({
    frame: SITE_FRAME,
    lookup: (id) => (id === ALIGN_TOOL_ID ? alignDrawing : id === "select" ? selectTool : undefined),
  });
  const client = fakeClient([...routes, { method: "GET", path: /\/drawings$/, body: { items: [] } }]);
  renderInWorkspace(
    <>
      <DrawingDialogs projectId={PROJECT_ID} frame={SITE_FRAME} />
      {extra}
    </>,
    { stores, api: client.api },
  );
  return { stores, requests: client.requests };
}
const ask = (
  kind: Parameters<ReturnType<typeof useDrawingUi.getState>["request"]>[0]["kind"],
  id = pdfDrawing.id,
) => act(() => useDrawingUi.getState().request({ kind, id }));

describe("DrawingDialogs (the row menu's actions, PF8)", () => {
  beforeEach(() => {
    useDrawingUi.getState().clear();
    useChangesStore.setState({ mapWorkspaceRevision: 0 });
    useDrawingsStore.getState().set(`${PROJECT_ID}:0`, PROJECT_ID, [pdfDrawing]);
    useAddData.setState({ open: false, tile: null, projectId: PROJECT_ID });
    useGoneLayers.setState({ gone: new Set() });
  });

  it("is a stage panel plugin", () => {
    expect(drawingDialogsPanel).toMatchObject({
      id: "drawing-dialogs",
      slot: "stage",
      Component: DrawingDialogs,
    });
  });

  it("Properties only selects the drawing (PF11)", () => {
    const { stores } = show();
    ask("properties");
    expect(stores.workspace.getState().selection).toEqual({ kind: "drawing", id: pdfDrawing.id });
    expect(stores.tools.getState().active).toBe("select");
  });

  it("Re-import opens Add data on Drawing with the source path", () => {
    show();
    ask("reimport");
    expect(useAddData.getState()).toMatchObject({ open: true, tile: "drawing" });
    expect(takeImportPrefill()).toBe(pdfDrawing.source_path);
  });

  it("Delete asks first, then deletes, marks the row gone silently and re-reads the workspace", async () => {
    const { stores, requests } = show([
      { method: "DELETE", path: new RegExp(`/drawings/${pdfDrawing.id}$`), status: 204 },
    ]);
    act(() => stores.workspace.getState().select({ kind: "drawing", id: pdfDrawing.id }));
    ask("delete");
    const dialog = screen.getByRole("dialog", { name: "Are you sure?" });
    expect(dialog).toHaveTextContent("The drawing leaves the project; the original file is not touched.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(requests.some((r) => r.method === "DELETE")).toBe(true);
    expect(useDrawingsStore.getState().byId[pdfDrawing.id]).toBeUndefined();
    expect(useGoneLayers.getState().gone.has(`drawing:${pdfDrawing.id}`)).toBe(true);
    expect(useChangesStore.getState().mapWorkspaceRevision).toBeGreaterThan(0);
    expect(useDrawingUi.getState().intent).toBeNull();
    expect(stores.workspace.getState().selection).toBeNull();
  });

  it("Cancel closes the delete confirmation without deleting", () => {
    const { requests } = show();
    ask("delete");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  it("ignores an intent for a drawing it does not know", () => {
    const { stores } = show();
    ask("reimport", "other");
    expect(useAddData.getState().open).toBe(false);
    expect(stores.tools.getState().active).toBe("select");
  });

  it("the row trash opens Are you sure, Cancel sends nothing, and Yes deletes", async () => {
    const row: LayerRow = {
      key: `drawing:${pdfDrawing.id}`,
      kind: "drawing",
      group: "drawings",
      id: pdfDrawing.id,
      name: pdfDrawing.name,
      meta: "",
      date: null,
    };
    const { requests } = show(
      [{ method: "DELETE", path: new RegExp(`/drawings/${pdfDrawing.id}$`), status: 204 }],
      <LayerRowView
        row={row}
        kind={{ id: "drawing", group: "drawings", icon: "trash", rows: () => [], menu: drawingRowMenu }}
        state={{ visible: true, opacity: 100 }}
        notInCompare={false}
        onState={() => {}}
        onMove={() => {}}
        onDropOn={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: `Delete ${pdfDrawing.name}` }));
    const dialog = screen.getByRole("dialog", { name: "Are you sure?" });
    expect(dialog).toHaveTextContent("The drawing leaves the project; the original file is not touched.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: `Delete ${pdfDrawing.name}` }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Are you sure?" })).getByRole("button", { name: "Yes" }),
    );
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE")).toBe(true));
  });
});
