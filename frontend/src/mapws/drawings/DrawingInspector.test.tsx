import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ApiClient } from "@contract/client";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import drawingInspector from "@/mapws/inspect/drawing.inspector";
import { useGoneLayers } from "@/mapws/layers/goneLayers";
import { useChangesStore } from "@/store/changes";
import { MISSED_DRAWING } from "../georef/alignModel";
import { sessionFor, useAlignStore } from "../georef/alignStore";
import { applyAffine, type Vec2 } from "../georef/fit";
import { REFUSAL_TEXT } from "../georef/messages";
import { DrawingInspector } from "./DrawingInspector";
import { useDrawingsStore } from "./drawingsStore";
import { DRAWING_ID, dxfDrawing, pdfDrawing, placedPdfDrawing, SITE_FRAME } from "./testFixtures";

const activate = vi.fn();
vi.mock("@/mapws/context", () => ({
  useTools: <T,>(sel: (s: { activate: (id: string) => void }) => T) => sel({ activate }),
}));

const VIEW: [number, number, number, number] = [500000, 4982000, 501000, 4983000];
const PAIRS: [Vec2, Vec2][] = [
  [
    [100, -100],
    [500002, 4982998],
  ],
  [
    [4800, -100],
    [500096, 4982998],
  ],
  [
    [100, -3400],
    [500002, 4982932],
  ],
];
/** The third pair picked mirrored (north of the first two instead of south): a similarity refuses it. */
const MIRRORED: [Vec2, Vec2] = [
  [100, -3400],
  [500002, 4983064],
];

function load(d = pdfDrawing) {
  useChangesStore.setState({ mapWorkspaceRevision: 0 });
  useDrawingsStore.getState().set(`${PROJECT_ID}:0`, PROJECT_ID, [d]);
}
function sessionWith(pairs: [Vec2, Vec2][], d = pdfDrawing) {
  act(() => useAlignStore.getState().begin(sessionFor(d, VIEW, SITE_FRAME).session));
  for (const [src, dst] of pairs) {
    act(() => useAlignStore.getState().click(applyAffine(useAlignStore.getState().session!.transform, src)));
    act(() => useAlignStore.getState().click(dst));
  }
}
function show(api: ApiClient, id = DRAWING_ID) {
  return renderWithProviders(
    <DrawingInspector
      selection={{ kind: "drawing", id }}
      projectId={PROJECT_ID}
      frame={SITE_FRAME}
      onClose={() => {}}
    />,
    { api },
  );
}

describe("DrawingInspector (spec §5.3)", () => {
  beforeEach(() => {
    useAlignStore.getState().end();
    useGoneLayers.setState({ gone: new Set() });
    activate.mockClear();
  });

  it("is registered as the framed inspector of drawings; Del confirms with the body sentence only (PF15)", () => {
    expect(drawingInspector).toMatchObject({ id: "drawing", label: "Drawing", framed: true });
    expect(drawingInspector.remove!.confirm({ kind: "drawing", id: DRAWING_ID })).toBe(
      "The drawing leaves the project; the original file is not touched.",
    );
  });

  it("Del removes the drawing: DELETE, the row marked gone silently, the workspace re-read", async () => {
    load();
    const { api, requests } = fakeClient([
      { method: "DELETE", path: new RegExp(`/drawings/${DRAWING_ID}$`), status: 204 },
    ]);
    await drawingInspector.remove!.run({ kind: "drawing", id: DRAWING_ID }, { api, projectId: PROJECT_ID });
    expect(requests.some((r) => r.method === "DELETE")).toBe(true);
    expect(useDrawingsStore.getState().byId[DRAWING_ID]).toBeUndefined();
    expect(useGoneLayers.getState().gone.has(`drawing:${DRAWING_ID}`)).toBe(true);
    expect(useChangesStore.getState().mapWorkspaceRevision).toBe(1);
  });

  it("an unplaced drawing offers Align, which activates the K tool", () => {
    load();
    show(fakeClient([]).api);
    expect(screen.getByText("Not placed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Align/ }));
    expect(activate).toHaveBeenCalledWith("align-drawing");
  });

  it("lists the session's pairs with residuals, then saves the placement and returns to Select", async () => {
    load();
    const { api, requests } = fakeClient([{ method: "PUT", path: /\/georef$/, body: placedPdfDrawing }]);
    show(api);
    sessionWith(PAIRS);
    const table = screen.getByRole("table", { name: "Control points" });
    expect(within(table).getAllByRole("row")).toHaveLength(4); // header + 3
    expect(within(table).getByText("col 100, row 100")).toBeInTheDocument();
    expect(screen.getByTestId("georef-rmse")).toHaveTextContent(/RMSE/);
    fireEvent.click(screen.getByRole("button", { name: "Save placement" }));
    await waitFor(() => expect(useAlignStore.getState().session).toBeNull());
    expect(requests.find((r) => r.method === "PUT")?.body).toMatchObject({
      model: "similarity",
      dst_frame: "site",
    });
    // Task 9 ruling: K is never left active without a session.
    expect(activate).toHaveBeenCalledWith("select");
  });

  it("Discard ends the session and returns to Select", () => {
    load();
    show(fakeClient([]).api);
    sessionWith(PAIRS.slice(0, 1));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(useAlignStore.getState().session).toBeNull();
    expect(activate).toHaveBeenCalledWith("select");
  });

  it("says 'Add a point to check the fit' at the minimum; a missing pair disables Save", () => {
    load();
    show(fakeClient([]).api);
    sessionWith(PAIRS.slice(0, 2));
    expect(screen.getByTestId("georef-rmse")).toHaveTextContent("Add a point to check the fit.");
    fireEvent.click(screen.getByRole("radio", { name: "Affine" }));
    expect(screen.getByTestId("georef-rmse")).toHaveTextContent("Add 1 more pair for an affine fit.");
    expect(screen.getByRole("button", { name: "Save placement" })).toBeDisabled();
  });

  it("a mirrored pick disables Save and says why in words", () => {
    load();
    show(fakeClient([]).api);
    sessionWith([...PAIRS.slice(0, 2), MIRRORED]);
    expect(screen.getByTestId("georef-rmse")).toHaveTextContent(REFUSAL_TEXT.reflection);
    expect(screen.getByRole("button", { name: "Save placement" })).toBeDisabled();
  });

  it("clicking the empty map first: the inspector explains the order", () => {
    load();
    show(fakeClient([]).api);
    sessionWith([]);
    act(() => useAlignStore.getState().click([500001, 4982001]));
    expect(screen.getByText(MISSED_DRAWING)).toBeInTheDocument();
  });

  it("says when a placement in another CRS starts afresh", () => {
    load();
    show(fakeClient([]).api);
    act(() =>
      useAlignStore.getState().begin(sessionFor(pdfDrawing, VIEW, SITE_FRAME).session, "Placed elsewhere."),
    );
    expect(screen.getByText("Placed elsewhere.")).toBeInTheDocument();
  });

  it("shows a server refusal in words", async () => {
    load();
    const { api } = fakeClient([
      {
        method: "PUT",
        path: /\/georef$/,
        status: 422,
        body: { error: { code: "collinear", message: "collinear", details: {} } },
      },
    ]);
    show(api);
    sessionWith(PAIRS);
    fireEvent.click(screen.getByRole("button", { name: "Save placement" }));
    expect(await screen.findByText(/lie on one line/)).toBeInTheDocument();
    expect(useAlignStore.getState().session).not.toBeNull();
    expect(activate).not.toHaveBeenCalledWith("select");
  });

  it("shows the saved RMSE, toggles knock out white, and clears the placement after confirming", async () => {
    load(placedPdfDrawing);
    const { api, requests } = fakeClient([
      { method: "DELETE", path: /\/georef$/, body: pdfDrawing },
      {
        method: "PATCH",
        path: new RegExp(`/drawings/${DRAWING_ID}$`),
        body: { ...placedPdfDrawing, layer_state: { hidden_layers: [], knockout_white: true } },
      },
    ]);
    show(api);
    expect(screen.getByTestId("georef-rmse")).toHaveTextContent("RMSE 6.0 cm");
    fireEvent.click(screen.getByRole("switch", { name: "Knock out white" }));
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({
      layer_state: { hidden_layers: [], knockout_white: true },
    });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Knock out white" })).toBeChecked());
    fireEvent.click(screen.getByRole("button", { name: "Clear placement" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Clear placement?" })).getByRole("button", {
        name: "Clear placement",
      }),
    );
    await waitFor(() => expect(screen.getByText("Not placed")).toBeInTheDocument());
  });

  it("shows a failed import with a Re-import action", () => {
    load({ ...pdfDrawing, status: "failed", error: "This PDF has no pages." });
    show(fakeClient([]).api);
    expect(screen.getByText("This PDF has no pages.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-import" })).toBeInTheDocument();
  });

  it("toggles a DXF layer through layer_state.hidden_layers", async () => {
    useDrawingsStore.getState().set(`${PROJECT_ID}:0`, PROJECT_ID, [dxfDrawing]);
    const { api, requests } = fakeClient([
      {
        method: "PATCH",
        path: new RegExp(`/drawings/${dxfDrawing.id}$`),
        body: {
          ...dxfDrawing,
          layer_state: { hidden_layers: [], knockout_white: false },
        },
      },
    ]);
    show(api, dxfDrawing.id);
    const text = screen.getByRole("checkbox", { name: /TEXT/ });
    expect(text).not.toBeChecked();
    fireEvent.click(text);
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({
      layer_state: { hidden_layers: [], knockout_white: false },
    });
  });

  it("discards an unsaved session when the drawing is deselected (unmount)", () => {
    load();
    const { unmount } = show(fakeClient([]).api);
    sessionWith(PAIRS.slice(0, 1));
    unmount();
    expect(useAlignStore.getState().session).toBeNull();
  });
});
