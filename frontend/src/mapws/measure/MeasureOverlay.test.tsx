import { beforeEach, describe, expect, it } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { errorBody, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { useToastStore } from "@/ui";
import { useChangesStore } from "@/store/changes";
import {
  DSM_SEP,
  LOCAL,
  MAP_SEP,
  MEASURE_ID,
  UTM38,
  measurement,
  renderInWorkspace,
  w3Stores,
} from "@/mapws/test/w3Fixtures";
import { DistanceOverlay, ProfileOverlay } from "./MeasureOverlay";

const line = {
  type: "LineString" as const,
  coordinates: [
    [0, 0],
    [30, 40],
    [30, 40],
  ] as [number, number][],
};

describe("MeasureOverlay", () => {
  beforeEach(() => {
    useToastStore.getState().clear();
  });

  it("saves a finished line with the right date's DSM and map, then selects it", async () => {
    const stores = w3Stores();
    const before = useChangesStore.getState().mapMeasurementsRevision;
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/map-measurements$/,
        status: 201,
        body: measurement("distance"),
      },
    ]);
    renderInWorkspace(<DistanceOverlay projectId={PROJECT_ID} frame={UTM38} />, { stores, api });
    act(() =>
      stores.tools.setState({
        completed: { toolId: "distance", geometry: line },
      }),
    );
    await waitFor(() =>
      expect(stores.workspace.getState().selection).toEqual({
        kind: "measurement",
        id: MEASURE_ID,
      }),
    );
    expect(stores.tools.getState().completed).toBeNull();
    expect(useChangesStore.getState().mapMeasurementsRevision).toBe(before + 1);
    // Review Focus 1: the double-click's repeated vertex is not sent.
    expect(requests.map((r) => r.body)).toEqual([
      {
        kind: "distance",
        vertices: [
          [0, 0],
          [30, 40],
        ],
        surface_ids: [DSM_SEP],
        map_id: MAP_SEP,
      },
    ]);
  });

  it("leaves another tool's geometry alone", () => {
    const stores = w3Stores();
    const { api, requests } = fakeClient([]);
    renderInWorkspace(<DistanceOverlay projectId={PROJECT_ID} frame={UTM38} />, { stores, api });
    act(() => stores.tools.setState({ completed: { toolId: "area", geometry: line } }));
    expect(requests).toHaveLength(0);
    expect(stores.tools.getState().completed).not.toBeNull();
  });

  it("explains a profile over no elevation and drops the geometry", async () => {
    const stores = w3Stores();
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/map-measurements$/,
        status: 422,
        body: errorBody("no_surface_under_line", "x"),
      },
    ]);
    renderInWorkspace(<ProfileOverlay projectId={PROJECT_ID} frame={UTM38} />, {
      stores,
      api,
    });
    act(() =>
      stores.tools.setState({
        completed: { toolId: "profile", geometry: line },
      }),
    );
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.text)).toContain("No elevation under this line"),
    );
    expect(useToastStore.getState().toasts.find((t) => t.text === "No elevation under this line")?.tone).toBe(
      "danger",
    );
    expect(stores.tools.getState().completed).toBeNull();
    expect(stores.workspace.getState().selection).toBeNull();
  });

  it("a client refusal toasts as info and sends nothing (W3-16)", async () => {
    const stores = w3Stores({ layers: [] });
    const { api, requests } = fakeClient([]);
    renderInWorkspace(<ProfileOverlay projectId={PROJECT_ID} frame={UTM38} />, {
      stores,
      api,
    });
    act(() =>
      stores.tools.setState({
        completed: { toolId: "profile", geometry: line },
      }),
    );
    await waitFor(() => expect(stores.tools.getState().completed).toBeNull());
    expect(requests).toHaveLength(0);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        tone: "info",
        text: "Profile needs an elevation layer — import one or build a DSM from a point cloud",
      }),
    ]);
  });

  it("shows the live grid length next to the pointer", () => {
    const stores = w3Stores();
    renderInWorkspace(<DistanceOverlay projectId={PROJECT_ID} frame={UTM38} />, {
      stores,
      api: fakeClient([]).api,
    });
    act(() => {
      stores.tools.setState({ draft: [[0, 0]] });
      stores.workspace.setState({
        pointer: [30, 40],
        viewApi: { pixelOf: () => [100, 100] } as never,
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent("≈ 50.00 m grid");
  });

  it("says local in a local-metres frame, and nothing without a second point", () => {
    const stores = w3Stores({ frame: LOCAL });
    renderInWorkspace(<DistanceOverlay projectId={PROJECT_ID} frame={LOCAL} />, {
      stores,
      api: fakeClient([]).api,
    });
    act(() => {
      stores.tools.setState({ draft: [[0, 0]] });
      stores.workspace.setState({
        viewApi: { pixelOf: () => [100, 100] } as never,
      });
    });
    expect(screen.queryByRole("status")).toBeNull();
    act(() => stores.workspace.setState({ pointer: [3, 4] }));
    expect(screen.getByRole("status")).toHaveTextContent("≈ 5.00 m local");
  });
});
