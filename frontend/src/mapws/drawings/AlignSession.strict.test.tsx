import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { create } from "zustand";
import "@/mapws/plugins";
import { InspectorHost } from "@/mapws/inspect/InspectorHost";
import { makeStores, renderInWorkspace } from "@/mapws/test/harness";
import alignDrawing from "@/mapws/tools/alignDrawing.tool";
import selectTool from "@/mapws/tools/select.tool";
import { useChangesStore } from "@/store/changes";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { useAlignStore } from "../georef/alignStore";
import { applyAffine, type Vec2 } from "../georef/fit";
import { ALIGN_TOOL_ID, AlignOverlay } from "./AlignOverlay";
import { useDrawingsStore } from "./drawingsStore";
import { DRAWING_ID, pdfDrawing, SITE_FRAME } from "./testFixtures";

// Task 8 F1: the row menu's "Align" selects the drawing and arms K in one commit, so the inspector
// and the K Overlay mount together. Under StrictMode (the dev build, and every e2e run) React
// unmounts and remounts both at once; the session the Overlay began must survive that.

const VIEW = { center: [500500, 4982500] as Vec2, resolution: 1, rotation: 0 };
/** Bumping the inspector's key is a genuine remount of it with the selection unchanged. */
const useInspectorKey = create<{ n: number }>(() => ({ n: 0 }));
const remountInspector = () => useInspectorKey.setState((s) => ({ n: s.n + 1 }));

function Workspace() {
  const n = useInspectorKey((s) => s.n);
  return (
    <>
      <AlignOverlay projectId={PROJECT_ID} frame={SITE_FRAME} />
      <InspectorHost key={n} projectId={PROJECT_ID} frame={SITE_FRAME} />
    </>
  );
}

function alignFromRowMenu() {
  useChangesStore.setState({ mapWorkspaceRevision: 0 });
  useDrawingsStore.getState().set(`${PROJECT_ID}:0`, PROJECT_ID, [pdfDrawing]);
  const stores = makeStores({
    frame: SITE_FRAME,
    lookup: (id) => (id === ALIGN_TOOL_ID ? alignDrawing : id === "select" ? selectTool : undefined),
  });
  stores.workspace.getState().setViewInfo(VIEW);
  renderInWorkspace(
    <StrictMode>
      <Workspace />
    </StrictMode>,
    { stores, api: fakeClient([]).api },
  );
  // DrawingDialogs' "align" intent: select, then arm K, in one commit.
  act(() => {
    stores.workspace.getState().select({ kind: "drawing", id: DRAWING_ID });
    stores.tools.getState().activate(ALIGN_TOOL_ID);
  });
  const inspector = () => screen.getByTestId("map-inspector");
  const clickDrawing = (src: Vec2) =>
    act(() => useAlignStore.getState().click(applyAffine(useAlignStore.getState().session!.transform, src)));
  return { stores, inspector, clickDrawing };
}

describe("the align session across StrictMode and inspector remounts (Task 8 F1)", () => {
  beforeEach(() => {
    useAlignStore.getState().end();
    useDrawingsStore.setState({ key: null, projectId: null, byId: {}, order: [] });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(1000);
  });
  afterEach(() => vi.restoreAllMocks());

  it("select + arm K in one commit leaves an active session: Save placement shows and clicks pair", async () => {
    const { inspector, clickDrawing } = alignFromRowMenu();
    await waitFor(() =>
      expect(within(inspector()).getByRole("button", { name: "Save placement" })).toBeDisabled(),
    );
    expect(within(inspector()).queryByRole("button", { name: "Align · K" })).toBeNull();
    expect(useAlignStore.getState().session?.drawingId).toBe(DRAWING_ID);
    clickDrawing([100, -100]);
    expect(within(inspector()).getByText("Now click the same point on the map.")).toBeInTheDocument();
  });

  it("a genuine remount of the inspector keeps the session and its pairs", async () => {
    const { inspector, clickDrawing } = alignFromRowMenu();
    await waitFor(() => expect(useAlignStore.getState().session?.drawingId).toBe(DRAWING_ID));
    clickDrawing([100, -100]);
    act(() => useAlignStore.getState().click([500002, 4982998]));
    act(() => remountInspector());
    await act(async () => {}); // let any deferred discard run
    expect(useAlignStore.getState().session?.pairs).toHaveLength(1);
    expect(within(inspector()).getByRole("table", { name: "Control points" })).toBeInTheDocument();
  });

  it("deselecting the drawing still discards its unsaved session", async () => {
    const { stores, clickDrawing } = alignFromRowMenu();
    await waitFor(() => expect(useAlignStore.getState().session?.drawingId).toBe(DRAWING_ID));
    clickDrawing([100, -100]);
    act(() => stores.tools.getState().activate("select"));
    act(() => stores.workspace.getState().select(null));
    await waitFor(() => expect(useAlignStore.getState().session).toBeNull());
  });
});
