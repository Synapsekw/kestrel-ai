import { act, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_ID } from "@/test/fixtures";
import { useStageSize } from "../compare/stageSize";
import { makeStores, renderInWorkspace } from "../test/harness";
import { UTM33, survey } from "../test/fixtures";
import { layerFeed, mapLayer } from "../test/rasterFixtures";
import { fakeView } from "../test/workspaceScreen";
import { Minimap } from "./Minimap";

vi.mock("../data/useWorkspaceLayers", async (importOriginal) => {
  const { layerFeed } = await import("../test/rasterFixtures");
  return {
    ...(await importOriginal<typeof import("../data/useWorkspaceLayers")>()),
    useWorkspaceLayers: () => layerFeed,
  };
});

type Seen = {
  ortho: string | null;
  ring: [number, number][] | null;
  extent: unknown;
  onRecentre: (c: [number, number]) => void;
};
const seen: Seen[] = [];
vi.mock("./MinimapCanvas", () => ({
  MinimapCanvas: (p: {
    ortho: { id: string } | null;
    ring: [number, number][] | null;
    extent: unknown;
    onRecentre: (c: [number, number]) => void;
  }) => {
    seen.push({
      ortho: p.ortho?.id ?? null,
      ring: p.ring,
      extent: p.extent,
      onRecentre: p.onRecentre,
    });
    return <div data-testid="minimap-canvas" />;
  },
}));

function setup() {
  const stores = makeStores({
    surveys: [survey("2026-08-14"), survey("2026-09-14")],
  });
  const centreOn = vi.fn();
  act(() => {
    stores.workspace.getState().setViewApi({ ...fakeView, centreOn });
    stores.workspace.getState().setViewInfo({ center: [50, 50], resolution: 0.05, rotation: 0 });
  });
  renderInWorkspace(<Minimap projectId={PROJECT_ID} frame={UTM33} />, {
    stores,
  });
  return { stores, centreOn };
}

describe("Minimap (M §5, deviation 5)", () => {
  beforeEach(() => {
    seen.length = 0;
    Object.assign(layerFeed, {
      loading: false,
      layers: [
        mapLayer("aug", "2026-08-14", { footprint_site: [0, 0, 100, 100] }),
        mapLayer("sep", "2026-09-14", { footprint_site: [0, 0, 100, 100] }),
      ],
    });
    useStageSize.setState({ size: [1000, 600] });
  });

  it("shows r's ortho, the site extent and the viewport, and recentres through W1's view API", () => {
    const { stores, centreOn } = setup();
    expect(screen.getByText("Site overview")).toBeInTheDocument();
    expect(seen.at(-1)?.ortho).toBe("sep");
    expect(seen.at(-1)?.extent).toEqual([0, 0, 100, 100]);
    expect(seen.at(-1)?.ring).toHaveLength(5);
    act(() => stores.workspace.getState().setDates(null, "2026-08-14"));
    expect(seen.at(-1)?.ortho).toBe("aug");
    seen.at(-1)?.onRecentre([10, 20]);
    expect(centreOn).toHaveBeenCalledWith([10, 20]);
  });

  it("draws one pane's viewport in Side-by-side (half the stage width)", () => {
    const { stores } = setup();
    // 1000 × 600 px at 0.05 m/px: 50 × 30 m around (50, 50).
    expect(seen.at(-1)?.ring?.[0]).toEqual([25, 35]);
    act(() => stores.workspace.getState().setMode("side"));
    // Each pane is 500 px wide: 25 × 30 m.
    expect(seen.at(-1)?.ring?.[0]).toEqual([37.5, 35]);
  });

  it("draws no viewport before the stage is measured", () => {
    useStageSize.setState({ size: null });
    setup();
    expect(seen.at(-1)?.ring).toBeNull();
  });
});
