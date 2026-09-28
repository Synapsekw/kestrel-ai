import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { create } from "zustand";
import type { ImageDetail } from "@/api/images";
import type { SelectionState } from "@/data/selection";
import { typedProject } from "@/test/findingFixtures";
import { exampleImage, fakeClient, IMAGE_ID, IMAGE_ID_2, PROJECT_ID } from "@/test/fixtures";
import { LocationProbe, TestApiProvider } from "@/test/render";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { useArrivalStore } from "./arrivalStore";
import { ImagesWorkspace } from "./ImagesWorkspace";
import workspaceSource from "./ImagesWorkspace.tsx?raw";
import browserSource from "./BrowserPane.tsx?raw";
import { KEYS_NOTICE, resetKeysNoticeSession } from "./keysNotice";
import type { ImageIndexState, KeyHandlers } from "./seams";

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  lastFilters: vi.fn(),
  imageData: vi.fn(),
  aiOptions: vi.fn(),
  ensureAiRegistered: vi.fn(),
  aiLayer: { accept: () => true } as Record<string, () => boolean>,
  layers: [] as Record<string, ((chord: string) => unknown) | undefined>[],
  keymapOpts: null as { enabled?: boolean } | null,
  loadError: null as string | null,
}));

function makeIndex(ids: string[], flags: number[]): ImageIndexState {
  return {
    status: "ready",
    error: null,
    errorCode: null,
    ids,
    flags,
    total: ids.length,
    sev: ids.map(() => 0),
    count: ids.map(() => 0),
    lon: ids.map((_, i) => (flags[i] & 4 ? 55.3 : null)),
    lat: ids.map((_, i) => (flags[i] & 4 ? 25.2 : null)),
    ordinalOf: (id) => (id === null ? -1 : ids.indexOf(id)),
    reload: () => {},
  };
}
/** Reactive: a filter change or a delete re-renders the workspace with the new index. */
const useIndex = create<{ index: ImageIndexState }>(() => ({
  index: makeIndex([IMAGE_ID, IMAGE_ID_2], [5, 0]),
}));
const setIndex = (ids: string[], flags = ids.map(() => 0)) =>
  act(() => useIndex.setState({ index: makeIndex(ids, flags) }));

const fw = (action: string) => act(() => void h.layers.find((l) => l[action])?.[action]?.(""));

vi.mock("@/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui")>()),
  toast: (...a: unknown[]) => h.toast(...a),
}));
vi.mock("./seams", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./seams")>()),
  useImageIndex: (_p: string, f: unknown) => {
    h.lastFilters(f);
    return useIndex((s) => s.index);
  },
  useImageData: (p: string, id: string) => {
    h.imageData(p, id);
    return { loading: false, error: h.loadError };
  },
  useCommandContext: () => ({}),
  useCanvasKeyHandlers: () => ({}),
  useImagesKeymap: (l: typeof h.layers, o: typeof h.keymapOpts) => {
    h.layers = l;
    h.keymapOpts = o;
  },
  useHeldKeys: () => {},
  useAiWorkspace: (o: unknown) => {
    h.aiOptions(o);
    return { keyHandlers: h.aiLayer };
  },
  ensureAiRegistered: () => h.ensureAiRegistered(),
  ImageCanvas: (p: { children?: ReactNode; suggestions?: ReactNode; overlay?: ReactNode }) => (
    <div data-testid="image-canvas">
      <div data-testid="canvas-suggestions">{p.suggestions ? "suggestions" : ""}</div>
      {p.children}
    </div>
  ),
  ToolPalette: (p: { children?: ReactNode }) => <div data-testid="tool-palette">{p.children}</div>,
  ZoomCluster: () => null,
  BrowserFilters: (p: { onChange: (f: unknown) => void; value: object }) => (
    <button type="button" onClick={() => p.onChange({ ...p.value, hasFindings: true })}>
      Filter stub
    </button>
  ),
  BrowserGrid: (p: { onSelectionChange: (s: SelectionState) => void }) => (
    <div data-testid="grid-stub">
      <button
        type="button"
        onClick={() => p.onSelectionChange({ selected: new Set([IMAGE_ID, IMAGE_ID_2]), anchor: IMAGE_ID_2 })}
      >
        Select both
      </button>
    </div>
  ),
  BrowserSelectionBar: (p: { selection: SelectionState; onDetect?: (ids: string[]) => void }) => (
    <button type="button" data-testid="selection-bar" onClick={() => p.onDetect?.([...p.selection.selected])}>
      {p.selection.selected.size} selected
    </button>
  ),
  CaptureMap: () => <div data-testid="map-stub" />,
  MiniMap: () => null,
  Filmstrip: () => null,
  AiHosts: () => <span data-testid="ai-hosts" />,
  AiBar: () => <span data-testid="ai-bar" />,
  AiDetectButton: () => <span data-testid="ai-detect-button" />,
  HintBar: () => <span data-testid="hint-bar" />,
  SuggestionChip: () => <span data-testid="suggestion-chip" />,
  SmartPolygonPanel: () => <span data-testid="smart-polygon-panel" />,
  SamWarmEdge: () => <span data-testid="sam-warm-edge" />,
  SuggestionsLayer: () => null,
  BatchDetectDialog: (p: { open: boolean; scopeLabel: string }) =>
    p.open ? <div role="dialog" aria-label="Detect on many images" data-scope={p.scopeLabel} /> : null,
  BatchDetectWatch: () => <span data-testid="batch-watch" />,
}));

const camera = {
  rel_alt: 38.4,
  gimbal_pitch: -90,
  gimbal_yaw: 0,
  focal_mm: null,
  focal_px: null,
  sensor_w_mm: null,
  lrf_distance_m: null,
  subject_distance_m: null,
  distance_m: 38.4,
  distance_sigma_m: 1,
  distance_source: "rel_alt",
  gsd_mm: 1.8,
  camera_model: null,
};
const detail = {
  ...exampleImage,
  camera,
  footprint: null,
  footprint_kind: "point",
} as unknown as ImageDetail;

function mount(url: string) {
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/projects\/[^/]+$/, body: typedProject },
    { method: "PATCH", path: /\/images\/[^/]+$/, body: (r) => ({ ...detail, ...(r.body as object) }) },
    { method: "GET", path: /\/findings$/, body: { items: [], next_cursor: null } },
    { method: "GET", path: /\/pointclouds$/, body: { items: [] } },
  ]);
  render(
    <TestApiProvider api={api}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/p/:projectId/images/:imageId?" element={<ImagesWorkspace />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </TestApiProvider>,
  );
  return { requests };
}
const loc = () => screen.getByTestId("location").textContent;

beforeEach(() => {
  localStorage.clear();
  resetKeysNoticeSession();
  h.toast.mockClear();
  h.lastFilters.mockClear();
  h.imageData.mockClear();
  h.aiOptions.mockClear();
  h.loadError = null;
  h.layers = [];
  useIndex.setState({ index: makeIndex([IMAGE_ID, IMAGE_ID_2], [5, 0]) });
  useImagesWorkspace.getState().reset();
  useImagesWorkspace.setState({ imageId: IMAGE_ID, image: detail });
  useArrivalStore.setState({ imageId: null, marker: null, cloudId: null });
  vi.unstubAllGlobals();
});

describe("ImagesWorkspace", () => {
  it("opens the first image of the index from the bare tab", async () => {
    mount(`/p/${PROJECT_ID}/images`);
    await waitFor(() => expect(loc()).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID}`));
    expect(screen.getByRole("heading", { level: 1, name: "Images" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Image browser" })).toBeInTheDocument();
    expect(screen.getByTestId("inspector-column")).toBeInTheDocument();
    expect(screen.getByTestId("images-status-bar")).toHaveTextContent(/Image\s*1\s*\/\s*2/);
  });

  it("an empty project shows the import state, never navigates and makes no image request", async () => {
    useIndex.setState({ index: makeIndex([], []) });
    const { requests } = mount(`/p/${PROJECT_ID}/images`);
    expect(await screen.findByText("This project has no images yet.")).toBeInTheDocument();
    expect(loc()).toBe(`/p/${PROJECT_ID}/images`);
    expect(h.imageData).not.toHaveBeenCalled();
    expect(requests.filter((r) => /\/images\/|image_id=/.test(r.url))).toEqual([]);
    // FA's hosts are unconditional: mounted even with no image open.
    expect(screen.getAllByTestId("ai-hosts")).toHaveLength(1);
    expect(screen.getByTestId("batch-watch")).toBeInTheDocument();
  });

  it("?filter=unlabeled seeds the filters and is dropped before the landing", async () => {
    mount(`/p/${PROJECT_ID}/images?filter=unlabeled`);
    await waitFor(() => expect(loc()).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID}`));
    expect(h.lastFilters).toHaveBeenLastCalledWith(expect.objectContaining({ unlabeled: true }));
  });

  it("?batch=1 opens the batch dialog and is dropped", async () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}?batch=1`);
    const dialog = await screen.findByRole("dialog", { name: "Detect on many images" });
    expect(dialog).toHaveAttribute("data-scope", "2 images");
    await waitFor(() => expect(loc()).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID}`));
    expect(h.keymapOpts).toEqual({ enabled: false });
  });

  it("next-image moves without remounting the panes", async () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}`);
    const pane = screen.getByRole("region", { name: "Image browser" });
    fw("next-image");
    await waitFor(() => expect(loc()).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID_2}`));
    expect(screen.getByRole("region", { name: "Image browser" })).toBe(pane);
  });

  it("the key layers go FA first, then FC's, then FW's", () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}`);
    expect(h.layers[0]).toBe(h.aiLayer);
    expect(Object.keys(h.layers[2] as KeyHandlers).sort()).toEqual(
      [
        "focus-comment",
        "grid-map",
        "next-image",
        "nothing-to-report",
        "previous-image",
        "toggle-browser",
        "toggle-inspector",
      ].sort(),
    );
    expect(h.aiOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        index: { ids: [IMAGE_ID, IMAGE_ID_2], flags: [5, 0] },
      }),
    );
  });

  it("previous-image at the start of the index hands the key on", () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}`);
    let result: unknown;
    act(() => {
      result = h.layers[2]["previous-image"]?.("");
    });
    expect(result).toBe(false);
    expect(loc()).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID}`);
  });

  it("grid-map switches Grid and Map; the map wrapper carries E's counts", () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}`);
    expect(screen.getByTestId("grid-stub")).toBeInTheDocument();
    fw("grid-map");
    expect(screen.getByTestId("map-stub")).toBeInTheDocument();
    const host = screen.getByTestId("capture-map-host");
    expect(host).toHaveAttribute("data-point-count", "1"); // flags bit 4 (GPS) on one frame
    expect(host).toHaveAttribute("data-footprint-kind", "point");
  });

  it("nothing-to-report marks the frame empty and updates FC's store", async () => {
    const { requests } = mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}`);
    fw("nothing-to-report");
    await waitFor(() =>
      expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ marked_empty: true }),
    );
    await waitFor(() => expect(useImagesWorkspace.getState().image?.marked_empty).toBe(true));
  });

  it("shows the keys-changed toast once", () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}`);
    expect(h.toast).toHaveBeenCalledWith("info", KEYS_NOTICE);
  });

  it("below 1100 px the inspector waits for toggle-inspector", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("960"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}`);
    expect(screen.queryByTestId("inspector-column")).toBeNull();
    fw("toggle-inspector");
    expect(screen.getByTestId("inspector-column")).toBeInTheDocument();
  });

  it("at full width the pane toggles hand their keys on", () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}`);
    expect(h.layers[2]["toggle-inspector"]?.("")).toBe(false);
    expect(h.layers[2]["toggle-browser"]?.("")).toBe(false);
  });

  it("Esc clears the arrival marker and keeps the chip", async () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}`);
    act(() => useArrivalStore.getState().arrive(IMAGE_ID, { px: 1, py: 1, r: 24 }, "c1"));
    expect(screen.getByTestId("arrival-marker")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("arrival-marker")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to 3D" })).toBeInTheDocument();
  });

  it("mounts FW's and FA's canvas parts inside the canvas, FA's detect button in the palette", () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}`);
    const canvas = screen.getByTestId("image-canvas");
    for (const id of [
      "image-info-chip",
      "ai-bar",
      "hint-bar",
      "suggestion-chip",
      "smart-polygon-panel",
      "sam-warm-edge",
    ])
      expect(within(canvas).getByTestId(id), id).toBeInTheDocument();
    expect(within(screen.getByTestId("tool-palette")).getByTestId("ai-detect-button")).toBeInTheDocument();
    // The L readout shows while a length is drawn.
    act(() =>
      useImagesWorkspace.setState({
        draft: { kind: "length", a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
      } as never),
    );
    expect(within(canvas).getByTestId("measure-readout")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-suggestions")).toHaveTextContent("suggestions");
    expect(screen.getAllByTestId("ai-hosts")).toHaveLength(1);
    expect(h.imageData).toHaveBeenCalledWith(PROJECT_ID, IMAGE_ID);
  });

  it("a frame that fails to load shows the error in the centre pane", () => {
    h.loadError = "Image not found.";
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}`);
    expect(screen.getByText("Image not found.")).toBeInTheDocument();
    expect(screen.queryByTestId("image-canvas")).toBeNull();
  });

  it("a filter change prunes the grid selection to the images still listed (I-FB hand-off)", async () => {
    const user = userEvent.setup();
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}`);
    await user.click(screen.getByRole("button", { name: "Select both" }));
    expect(screen.getByTestId("selection-bar")).toHaveTextContent("2 selected");
    await user.click(screen.getByRole("button", { name: "Filter stub" }));
    setIndex([IMAGE_ID]);
    expect(screen.getByTestId("selection-bar")).toHaveTextContent("1 selected");
    await user.click(screen.getByTestId("selection-bar"));
    expect(await screen.findByRole("dialog", { name: "Detect on many images" })).toHaveAttribute(
      "data-scope",
      "1 selected",
    );
  });

  it("reads the image index exactly once for the whole workspace (budget)", () => {
    expect(workspaceSource.match(/\buseImageIndex\(/g)).toHaveLength(1);
    expect(browserSource).not.toMatch(/\buseImageIndex\(/);
    expect(h.ensureAiRegistered).toHaveBeenCalled();
  });
});
