import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { create } from "zustand";
import type { Drawing } from "@/api/drawings";
import "@/mapws/plugins";
import { makeStores, renderInWorkspace } from "@/mapws/test/harness";
import alignDrawing from "@/mapws/tools/alignDrawing.tool";
import selectTool from "@/mapws/tools/select.tool";
import { toolRegistry } from "@/mapws/tools/toolStore";
import type { SiteFrame } from "@/mapws/types";
import { useChangesStore } from "@/store/changes";
import { fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { useToastStore } from "@/ui";
import { MISSED_DRAWING } from "../georef/alignModel";
import { useAlignStore } from "../georef/alignStore";
import { applyAffine, type Vec2 } from "../georef/fit";
import { REFUSAL_TEXT } from "../georef/messages";
import { ALIGN_TOOL_ID, AlignOverlay } from "./AlignOverlay";
import { useDrawingsStore } from "./drawingsStore";
import { DRAWING_ID, drawingRowOf, pdfDrawing, placedPdfDrawing, SITE_FRAME } from "./testFixtures";

const ROW_KEY = `drawing:${DRAWING_ID}`;
/** The view the workspace store publishes, and the 1000 × 1000 px stage the Overlay measures. */
const VIEW = { center: [500500, 4982500] as Vec2, resolution: 1, rotation: 0 };
const OTHER_FRAME: SiteFrame = { ...SITE_FRAME, epsg: 32639, crs_wkt: 'PROJCRS["UTM 39N",ID["EPSG",32639]]' };

/** The site frame the workspace hands the Overlay; a test switches it mid-session. */
const useFrame = create<{ frame: SiteFrame }>(() => ({ frame: SITE_FRAME }));
const switchFrame = (frame: SiteFrame) => useFrame.setState({ frame });
function Host() {
  const frame = useFrame((s) => s.frame);
  return <AlignOverlay projectId={PROJECT_ID} frame={frame} />;
}

function mount(o: { seed?: Drawing[] | null; routes?: FakeRoute[]; hidden?: boolean } = {}) {
  useFrame.setState({ frame: SITE_FRAME });
  if (o.seed !== null) useDrawingsStore.getState().set(`${PROJECT_ID}:0`, PROJECT_ID, o.seed ?? [pdfDrawing]);
  const stores = makeStores({
    frame: SITE_FRAME,
    lookup: (id) => (id === ALIGN_TOOL_ID ? alignDrawing : id === "select" ? selectTool : undefined),
  });
  const ws = stores.workspace.getState();
  ws.setViewInfo(VIEW);
  if (o.hidden) ws.setLayerState(ROW_KEY, { visible: false });
  ws.select({ kind: "drawing", id: DRAWING_ID });
  stores.tools.getState().activate(ALIGN_TOOL_ID);
  // The first matching route answers: `routes` override the saving PUT.
  const client = fakeClient([
    ...(o.routes ?? []),
    { method: "PUT", path: /\/georef$/, body: placedPdfDrawing },
  ]);
  renderInWorkspace(<Host />, { stores, api: client.api });
  // W1's point draw spec: every map click completes one Point, and further clicks wait until it is cleared.
  const click = (c: Vec2) => act(() => stores.tools.getState().addVertex(c));
  return { stores, click, requests: client.requests };
}

const onDrawing = (src: Vec2): Vec2 => applyAffine(useAlignStore.getState().session!.transform, src);

function key(k: string, target: EventTarget = window, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(e));
  return e;
}

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
  [
    [4800, -3400],
    [500096, 4982932],
  ],
];

describe("the align-drawing tool (spec §8.3)", () => {
  beforeEach(() => {
    useChangesStore.setState({ mapWorkspaceRevision: 0 });
    useAlignStore.getState().end();
    useDrawingsStore.setState({ key: null, projectId: null, byId: {}, order: [] });
    useToastStore.getState().clear();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(1000);
  });
  afterEach(() => vi.restoreAllMocks());

  it("is the K tool of the site group, discovered as a plugin, usable only with a ready drawing selected", () => {
    expect(alignDrawing).toMatchObject({
      id: "align-drawing",
      action: "align-drawing",
      group: "site",
      icon: "align",
      draw: { shape: "point" },
    });
    expect(toolRegistry.get("align-drawing")).toBe(alignDrawing);
    const row = drawingRowOf(pdfDrawing).layer!;
    const ctx = { frame: SITE_FRAME, selection: null, surveys: [], layers: [row], r: null };
    const selection = { kind: "drawing", id: DRAWING_ID };
    expect(alignDrawing.disabledReason!(ctx)).toBe("Select a drawing first");
    expect(alignDrawing.disabledReason!({ ...ctx, selection: { kind: "finding", id: "f1" } })).toBe(
      "Select a drawing first",
    );
    expect(alignDrawing.disabledReason!({ ...ctx, selection })).toBeNull();
    expect(
      alignDrawing.disabledReason!({ ...ctx, selection, layers: [{ ...row, status: "importing" }] }),
    ).toBe("The drawing is still importing");
    expect(alignDrawing.disabledReason!({ ...ctx, selection, layers: [{ ...row, status: "failed" }] })).toBe(
      "The drawing failed to import",
    );
  });

  it("starts a provisional session at 60% of the view, centred, and pairs two clicks from W1's completed points", () => {
    const { stores, click } = mount();
    const s0 = useAlignStore.getState().session!;
    expect(s0.drawingId).toBe(DRAWING_ID);
    const [e0, n0, e1, n1] = [
      ...applyAffine(s0.transform, [0, -3508]),
      ...applyAffine(s0.transform, [4967, 0]),
    ];
    expect((e0 + e1) / 2).toBeCloseTo(500500);
    expect((n0 + n1) / 2).toBeCloseTo(4982500);
    expect(e1 - e0).toBeCloseTo(600);
    click(onDrawing([100, -100]));
    expect(stores.tools.getState().completed).toBeNull();
    expect(useAlignStore.getState().session!.pendingSrc).not.toBeNull();
    click([500002, 4982998]);
    const s = useAlignStore.getState().session!;
    expect(s.pairs).toHaveLength(1);
    expect(s.pairs[0].src[0]).toBeCloseTo(100);
    expect(s.pairs[0].dst).toEqual([500002, 4982998]);
  });

  it("starts once the drawings list arrives", async () => {
    mount({ seed: null, routes: [{ method: "GET", path: /\/drawings$/, body: { items: [pdfDrawing] } }] });
    expect(useAlignStore.getState().session).toBeNull();
    await waitFor(() => expect(useAlignStore.getState().session?.drawingId).toBe(DRAWING_ID));
  });

  it("does not start on a drawing that is still importing", () => {
    mount({ seed: [{ ...pdfDrawing, status: "importing" }] });
    expect(useAlignStore.getState().session).toBeNull();
  });

  it("shows a hidden drawing row, so its map layer (and the marks) exist", () => {
    const { stores } = mount({ hidden: true });
    expect(stores.workspace.getState().layerState[ROW_KEY].visible).toBe(true);
  });

  it("starts afresh when the drawing is deselected (its session discarded) and selected again", () => {
    const { stores } = mount();
    act(() => {
      stores.workspace.getState().select(null);
      useAlignStore.getState().end();
    });
    expect(useAlignStore.getState().session).toBeNull();
    act(() => stores.workspace.getState().select({ kind: "drawing", id: DRAWING_ID }));
    expect(useAlignStore.getState().session?.drawingId).toBe(DRAWING_ID);
  });

  it("resumes a placement saved in the site frame with its points", () => {
    mount({ seed: [placedPdfDrawing] });
    const s = useAlignStore.getState().session!;
    expect(s.pairs.map((p) => p.id)).toEqual(["cp1", "cp2", "cp3"]);
    expect(useAlignStore.getState().notice).toBeNull();
  });

  it("ignores a first click off the drawing and says why", () => {
    const { click } = mount();
    click([500001, 4982001]);
    expect(useAlignStore.getState().session!.pendingSrc).toBeNull();
    expect(useAlignStore.getState().notice).toBe(MISSED_DRAWING);
  });

  it("Esc clears a pending click before W1 sees it; with nothing pending it returns to Select, keeping the session", () => {
    const { stores, click } = mount();
    click(onDrawing(PAIRS[0][0]));
    click(PAIRS[0][1]);
    click(onDrawing([100, -100]));
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(useAlignStore.getState().session!.pendingSrc).toBeNull();
    expect(stores.tools.getState().active).toBe(ALIGN_TOOL_ID);
    // Final review #1: nothing pending — K hands back to Select; the unsaved pairs stay (not W1's
    // cancel, which would deselect the drawing and discard the session).
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(stores.tools.getState().active).toBe("select");
    expect(stores.workspace.getState().selection).toEqual({ kind: "drawing", id: DRAWING_ID });
    expect(useAlignStore.getState().session!.pairs).toHaveLength(1);
  });

  it("the hint says what Esc and Backspace do", () => {
    expect(alignDrawing.hint).toContain("Esc cancels a pending click · Backspace removes the last pair");
  });

  it("a site-frame switch mid-session ends the old-frame session and starts afresh", () => {
    const { click } = mount();
    click(onDrawing(PAIRS[0][0]));
    click(PAIRS[0][1]);
    expect(useAlignStore.getState().session!.pairs).toHaveLength(1);
    act(() => switchFrame(OTHER_FRAME));
    const s = useAlignStore.getState().session!;
    expect(s.drawingId).toBe(DRAWING_ID);
    expect(s.pairs).toHaveLength(0);
  });

  it("a save at the minimum pair count does not claim a perfect fit", async () => {
    const { click } = mount();
    for (const [src, dst] of PAIRS.slice(0, 2)) {
      click(onDrawing(src));
      click(dst);
    }
    // Two pairs fit a similarity exactly: Enter needs a valid fit, which the minimum is.
    key("Enter");
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual(["Placement saved"]),
    );
  });

  it("leaves keys typed into a field alone", () => {
    const { click } = mount();
    click(onDrawing([100, -100]));
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(key("Escape", input).defaultPrevented).toBe(false);
    expect(useAlignStore.getState().session!.pendingSrc).not.toBeNull();
    input.remove();
  });

  it("Backspace removes the last pair; Enter saves a valid fit with PUT georef and ends the session", async () => {
    const { stores, click, requests } = mount();
    for (const [src, dst] of PAIRS) {
      click(onDrawing(src));
      click(dst);
    }
    expect(key("Backspace").defaultPrevented).toBe(true);
    expect(useAlignStore.getState().session!.pairs).toHaveLength(3);
    expect(key("z", window, { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(useAlignStore.getState().session!.pairs).toHaveLength(2);
    click(onDrawing(PAIRS[2][0]));
    click(PAIRS[2][1]);
    expect(key("Enter").defaultPrevented).toBe(true);
    // A second Enter while the save is in flight sends nothing more.
    key("Enter");
    await waitFor(() => expect(useAlignStore.getState().session).toBeNull());
    // Task 9 ruling: a save hands back to Select, so K is never left active without a session.
    await act(async () => {});
    expect(useAlignStore.getState().session).toBeNull();
    expect(stores.tools.getState().active).toBe("select");
    const puts = requests.filter((r) => r.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toMatchObject({ model: "similarity", dst_frame: "site" });
    expect((puts[0].body as { points: unknown[] }).points).toHaveLength(3);
    expect(useDrawingsStore.getState().byId[DRAWING_ID].georef_version).toBe(2);
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual(["Placement saved · RMSE 6.0 cm"]);
  });

  it("Enter without a valid fit passes through to W1", () => {
    const { click } = mount();
    click(onDrawing(PAIRS[0][0]));
    click(PAIRS[0][1]);
    expect(key("Enter").defaultPrevented).toBe(false);
    expect(useAlignStore.getState().session).not.toBeNull();
  });

  it("a mirrored third pair keeps the transform, and Enter neither acts nor saves", async () => {
    const { click, requests } = mount();
    for (const [src, dst] of PAIRS.slice(0, 2)) {
      click(onDrawing(src));
      click(dst);
    }
    const before = useAlignStore.getState().session!.transform;
    click(onDrawing([100, -3400]));
    // Mirrored: north of the first two pairs on the map, south of them on the drawing.
    click([500002, 4983064]);
    const s = useAlignStore.getState().session!;
    expect(s.pairs).toHaveLength(3);
    expect(s.fit).toMatchObject({ ok: false, error: "reflection" });
    expect(s.transform).toEqual(before);
    expect(key("Enter").defaultPrevented).toBe(false);
    await act(async () => {});
    expect(requests.some((r) => r.method === "PUT")).toBe(false);
    expect(useAlignStore.getState().session).not.toBeNull();
  });

  it("a refused save keeps the session and says why", async () => {
    const { click } = mount({
      routes: [
        {
          method: "PUT",
          path: /\/georef$/,
          status: 422,
          body: { error: { code: "collinear", message: "collinear", details: {} } },
        },
      ],
    });
    for (const [src, dst] of PAIRS.slice(0, 3)) {
      click(onDrawing(src));
      click(dst);
    }
    key("Enter");
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual([REFUSAL_TEXT.collinear]),
    );
    expect(useAlignStore.getState().session!.pairs).toHaveLength(3);
  });
});
