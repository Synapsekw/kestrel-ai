import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type OlMap from "ol/Map";
import { useChangesStore } from "@/store/changes";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { WorkspaceProvider, type MapSide, type SiteFrame } from "@/mapws/annotations/bindings";
import { LOCAL, MAP_AUG, MAP_SEP, UTM38, w3Stores } from "@/mapws/test/w3Fixtures";
import { useMapFindingsStore } from "./store";
import { MOVE_DEBOUNCE_MS, useFindingsInView } from "./useFindingsInView";

const PIN = {
  id: "f1",
  number: 1,
  type_id: "t",
  severity: 4,
  status: "open",
  created_by: "human",
  map_id: MAP_SEP,
  geometry_site: { type: "Point", coordinates: [500100, 3300100] },
};

/** The parts of an ol/Map the hook touches: moveend and the view extent. */
function fakeMap() {
  const handlers = new Set<() => void>();
  const map = {
    on: (_: string, h: () => void) => handlers.add(h),
    un: (_: string, h: () => void) => handlers.delete(h),
    getSize: () => [800, 600],
    getView: () => ({ calculateExtent: () => [500000, 3300000, 500800.125, 3300600] }),
  };
  return { map: map as unknown as OlMap, moveEnd: () => handlers.forEach((h) => h()) };
}

function setup(opts: { mode?: "single" | "side"; truncated?: boolean } = {}) {
  const { api, requests } = fakeClient(
    [
      {
        method: "GET",
        path: /\/map-workspace\/findings$/,
        body: { items: [PIN], truncated: opts.truncated ?? false },
      },
    ],
    { signalSafe: true },
  );
  const get = vi.spyOn(api, "GET");
  const stores = w3Stores({ mode: opts.mode });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider api={api}>
      <WorkspaceProvider value={stores}>{children}</WorkspaceProvider>
    </TestApiProvider>
  );
  const signals = () =>
    get.mock.calls.map((c) => (c[1] as { signal?: AbortSignal } | undefined)?.signal as AbortSignal);
  return { requests, wrapper, signals };
}

const reads = (requests: { url: string }[]) =>
  requests.filter((r) => r.url.includes("/map-workspace/findings"));

function render(
  wrapper: (p: { children: ReactNode }) => ReactNode,
  map: OlMap,
  props: { side?: MapSide; frame?: SiteFrame; allSurveys?: boolean } = {},
) {
  return renderHook(
    (p: { side: MapSide; frame: SiteFrame; allSurveys: boolean }) =>
      useFindingsInView(map, { projectId: PROJECT_ID, ...p }),
    {
      wrapper,
      initialProps: { side: "single", frame: UTM38, allSurveys: false, ...props },
    },
  );
}

describe("useFindingsInView (bounded read, spec §13)", () => {
  beforeEach(() => {
    for (const s of ["single", "left", "right"] as const) useMapFindingsStore.getState().clearSide(s);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the viewport bbox and the single map's survey into its side of the store", async () => {
    const { requests, wrapper } = setup();
    const { map } = fakeMap();
    render(wrapper, map);
    await waitFor(() => expect(useMapFindingsStore.getState().bySide.single).toHaveLength(1));
    const url = decodeURIComponent(reads(requests)[0].url);
    expect(url).toContain("bbox=500000.00,3300000.00,500800.13,3300600.00");
    expect(url).toContain("frame=site");
    expect(url).toContain(`map_ids=${MAP_SEP}`);
    expect(url).not.toContain(MAP_AUG);
    expect(useMapFindingsStore.getState().byId.f1).toBeDefined();
  });

  it("each Side-by-side pane asks for its own date's maps (W3-13)", async () => {
    const { requests, wrapper } = setup({ mode: "side" });
    const { map } = fakeMap();
    render(wrapper, map, { side: "left" });
    render(wrapper, map, { side: "right" });
    await waitFor(() => expect(reads(requests)).toHaveLength(2));
    const [left, right] = reads(requests).map((r) => decodeURIComponent(r.url));
    expect(left).toContain(`map_ids=${MAP_AUG}`);
    expect(left).not.toContain(MAP_SEP);
    expect(right).toContain(`map_ids=${MAP_SEP}`);
    expect(right).not.toContain(MAP_AUG);
  });

  it("All surveys sends no map_ids", async () => {
    const { requests, wrapper } = setup();
    const { map } = fakeMap();
    render(wrapper, map, { allSurveys: true });
    await waitFor(() => expect(reads(requests)).toHaveLength(1));
    expect(reads(requests)[0].url).not.toContain("map_ids");
  });

  it("re-reads once per settled move (debounced) and aborts the previous request", async () => {
    const { requests, wrapper, signals } = setup();
    const { map, moveEnd } = fakeMap();
    render(wrapper, map);
    await waitFor(() => expect(reads(requests)).toHaveLength(1));
    act(() => {
      moveEnd();
      moveEnd();
      moveEnd();
    });
    await new Promise((r) => setTimeout(r, MOVE_DEBOUNCE_MS / 2));
    expect(reads(requests)).toHaveLength(1);
    await waitFor(() => expect(reads(requests)).toHaveLength(2));
    await new Promise((r) => setTimeout(r, MOVE_DEBOUNCE_MS + 50));
    expect(reads(requests)).toHaveLength(2);
    expect(signals()[0].aborted).toBe(true);
    expect(signals()[1].aborted).toBe(false);
  });

  it("re-reads on findingsRevision", async () => {
    const { requests, wrapper } = setup();
    const { map } = fakeMap();
    render(wrapper, map);
    await waitFor(() => expect(reads(requests)).toHaveLength(1));
    act(() => useChangesStore.getState().bumpFindings());
    await waitFor(() => expect(reads(requests)).toHaveLength(2));
  });

  it("keeps the truncated flag of its own side", async () => {
    const { wrapper } = setup({ truncated: true });
    const { map } = fakeMap();
    render(wrapper, map, { side: "right" });
    await waitFor(() => expect(useMapFindingsStore.getState().truncatedBySide.right).toBe(true));
    expect(useMapFindingsStore.getState().truncated).toBe(true);
  });

  it("reads nothing in a local frame and empties its side", async () => {
    useMapFindingsStore.getState().setSide("single", [PIN as never], true);
    const { requests, wrapper } = setup();
    const { map, moveEnd } = fakeMap();
    render(wrapper, map, { frame: LOCAL });
    act(() => moveEnd());
    await new Promise((r) => setTimeout(r, MOVE_DEBOUNCE_MS + 50));
    expect(reads(requests)).toHaveLength(0);
    expect(useMapFindingsStore.getState().bySide.single).toEqual([]);
    expect(useMapFindingsStore.getState().truncated).toBe(false);
  });

  it("drops its side from the store on unmount", async () => {
    const { wrapper } = setup();
    const { map } = fakeMap();
    const { unmount } = render(wrapper, map, { side: "left" });
    await waitFor(() => expect(useMapFindingsStore.getState().byId.f1).toBeDefined());
    unmount();
    expect(useMapFindingsStore.getState().byId).toEqual({});
  });
});
