import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChangesStore } from "@/store/changes";
import { layer } from "../test/fixtures";
import { makeStores } from "../test/harness";
import { AUG, layerFeed, mapLayer, surfaceLayer, workspaceWrapper } from "../test/rasterFixtures";
import { bumpWorkspaceData, useRasterLayers } from "./useRasterLayers";

vi.mock("../data/useWorkspaceLayers", async (importOriginal) => {
  const { layerFeed } = await import("../test/rasterFixtures");
  return {
    ...(await importOriginal<typeof import("../data/useWorkspaceLayers")>()),
    useWorkspaceLayers: () => layerFeed,
  };
});

function Probe() {
  const layers = useRasterLayers();
  return <p>{layers === null ? "loading" : layers.map((l) => l.id).join(",")}</p>;
}

const renderProbe = () => render(<Probe />, { wrapper: workspaceWrapper(makeStores()) });

describe("useRasterLayers (Budget: W1's one read)", () => {
  beforeEach(() => Object.assign(layerFeed, { layers: [], loading: false }));

  it("is null while W1 loads, then keeps maps and surfaces only", () => {
    Object.assign(layerFeed, { layers: [], loading: true });
    const { rerender } = renderProbe();
    expect(screen.getByText("loading")).toBeInTheDocument();
    Object.assign(layerFeed, {
      layers: [mapLayer("m1", AUG), surfaceLayer("s1", AUG), layer("drawing", "d1")],
      loading: false,
    });
    rerender(<Probe />);
    expect(screen.getByText("m1,s1")).toBeInTheDocument();
  });

  it("keeps returning layers once loaded, though W1 flips loading on every re-read", () => {
    Object.assign(layerFeed, { layers: [mapLayer("m1", AUG)], loading: false });
    const { rerender } = renderProbe();
    expect(screen.getByText("m1")).toBeInTheDocument();
    Object.assign(layerFeed, { layers: [mapLayer("m1", AUG)], loading: true });
    rerender(<Probe />);
    expect(screen.getByText("m1")).toBeInTheDocument();
    Object.assign(layerFeed, { layers: [], loading: true });
    rerender(<Probe />);
    expect(screen.queryByText("loading")).toBeNull();
  });

  it("bumps W1's revision after a W2 write", () => {
    const rev = useChangesStore.getState().mapWorkspaceRevision;
    const surf = useChangesStore.getState().surfacesRevision;
    act(() => bumpWorkspaceData(true));
    expect(useChangesStore.getState().mapWorkspaceRevision).toBe(rev + 1);
    expect(useChangesStore.getState().surfacesRevision).toBe(surf + 1);
    act(() => bumpWorkspaceData());
    expect(useChangesStore.getState().mapWorkspaceRevision).toBe(rev + 2);
    expect(useChangesStore.getState().surfacesRevision).toBe(surf + 1);
  });
});
