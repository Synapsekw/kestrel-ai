/* eslint-disable react-refresh/only-export-components --
   a test-only stand-in for SiteMap next to the fixtures it is used with; not a fast-refresh boundary. */
import { useEffect } from "react";
import { vi } from "vitest";
import type { FakeRoute } from "@/test/fixtures";
import { useWorkspace } from "../context";
import type { ViewApi } from "../state/workspaceStore";
import { UTM33, survey } from "./fixtures";

/**
 * The MapWorkspace test setup shared by MapWorkspace.test.tsx and MapWorkspace.arrival.test.tsx
 * (D4). Each test file mocks `./view/SiteMap` with `FakeSiteMap` (vi.mock must live in the test
 * file); `fakeView` is the view API it publishes.
 */
export const fakeView = {
  centreOn: vi.fn<ViewApi["centreOn"]>(),
  fit: vi.fn<ViewApi["fit"]>(),
  zoomBy: vi.fn<ViewApi["zoomBy"]>(),
  resetNorth: vi.fn<ViewApi["resetNorth"]>(),
  pixelOf: vi.fn<ViewApi["pixelOf"]>(() => null),
  coordOf: vi.fn<ViewApi["coordOf"]>(() => null),
  selectionAt: vi.fn<ViewApi["selectionAt"]>(() => null),
};

/** Publishes `fakeView` as the view API and exposes the mode, the placement count and play. */
export function FakeSiteMap(p: { mode: string; placements: readonly unknown[] }) {
  const setViewApi = useWorkspace((s) => s.setViewApi);
  const playing = useWorkspace((s) => s.playing);
  useEffect(() => {
    setViewApi(fakeView);
    return () => setViewApi(null);
  }, [setViewApi]);
  return (
    <div
      data-testid="site-map"
      data-mode={p.mode}
      data-placed={p.placements.length}
      data-playing={String(playing)}
    />
  );
}

export const WS = {
  frame: UTM33,
  state: {},
  planned_surveys: [],
  frame_items: { crs: 1, local: 0 },
  updated_at: "2026-09-27T10:00:00Z",
};

export const SURVEY_DATES = ["2026-03-01", "2026-04-15", "2026-05-20"] as const;

export const SURVEYS = {
  items: SURVEY_DATES.map((date) =>
    survey(date, {
      maps: [{ id: `m-${date}`, name: "Ortho", gsd_cm: 3, basis_run_id: null }],
    }),
  ),
};

/** The workspace's own reads (frame + state, its PUT, layers, surveys, clouds); `over` replaces a body. */
export function workspaceRoutes(
  over: Partial<Record<"ws" | "layers" | "surveys", FakeRoute["body"]>> = {},
): FakeRoute[] {
  return [
    { method: "GET", path: /\/map-workspace$/, body: over.ws ?? WS },
    { method: "PUT", path: /\/map-workspace$/, body: WS },
    {
      method: "GET",
      path: /\/map-workspace\/layers$/,
      body: over.layers ?? { frame: UTM33, items: [] },
    },
    {
      method: "GET",
      path: /\/map-workspace\/surveys$/,
      body: over.surveys ?? SURVEYS,
    },
    { method: "GET", path: /\/pointclouds$/, body: { items: [] } },
  ];
}
