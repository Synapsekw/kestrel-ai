import { act, fireEvent, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDetectStore } from "../detect/detectStore";
import { DEFAULT_FILTERS } from "../detect/detectModel";
import { useMapFindingsStore } from "../findings/store";
import { useRasterActions } from "../layers/rasterMenu";
import { useMeasurementsStore } from "../measure/store";
import type { ViewApi } from "../state/workspaceStore";
import { useZonesStore } from "../zones/store";
import { AiTopic } from "./AiTopic";
import { DrawingsTopic } from "./DrawingsTopic";
import { FindingsTopic } from "./FindingsTopic";
import { LayersTopic } from "./LayersTopic";
import { MeasureTopic } from "./MeasureTopic";
import { renderTopic } from "./testTopic";
import { usePendingCount } from "./usePendingCount";

afterEach(() => {
  useMapFindingsStore.getState().clearSide("single");
  useZonesStore.getState().set([]);
  useMeasurementsStore.getState().set([], false);
  useDetectStore.setState({ filters: DEFAULT_FILTERS, byId: new Map(), inView: {} });
  useRasterActions.getState().clear();
});

const fakeView = () =>
  ({ fit: vi.fn(), centreOn: vi.fn() }) as unknown as ViewApi & {
    fit: ReturnType<typeof vi.fn>;
    centreOn: ReturnType<typeof vi.fn>;
  };

describe("map topics", () => {
  it("Findings: point, polygon and zone tools, filters, list", () => {
    renderTopic(FindingsTopic);
    for (const name of ["Add finding point", "Add finding polygon", "Zone"])
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Category" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "All surveys" })).toBeNull();
  });

  it("Findings eye hides findings and zones together", () => {
    const { workspace } = renderTopic(FindingsTopic);
    fireEvent.click(screen.getByRole("button", { name: "Hide findings" }));
    const s = workspace.getState().layerState;
    expect(s["findings:all"]?.visible).toBe(false);
    expect(s["zones:all"]?.visible).toBe(false);
    expect(screen.getByRole("button", { name: "Show findings" })).toBeInTheDocument();
  });

  it("using a creation tool turns a hidden topic back on", () => {
    const { workspace, tools } = renderTopic(FindingsTopic);
    fireEvent.click(screen.getByRole("button", { name: "Hide findings" }));
    fireEvent.click(screen.getByRole("button", { name: "Add finding point" }));
    expect(tools.getState().active).toBe("finding-point");
    expect(workspace.getState().layerState["findings:all"]?.visible).toBe(true);
  });

  it("clicking a list row selects it and frames it", () => {
    const { workspace } = renderTopic(FindingsTopic, { findings: [{ id: "f1", number: 1 }] });
    const view = fakeView();
    act(() => workspace.getState().setViewApi(view));
    fireEvent.click(screen.getByRole("option", { name: /F-0001/ }));
    expect(workspace.getState().selection).toEqual({ kind: "finding", id: "f1" });
    expect(view.centreOn).toHaveBeenCalledWith([10, 20]);
  });

  it("lists zones after findings and frames a zone's outline", () => {
    useZonesStore.getState().set([
      {
        id: "z1",
        name: "Yard",
        category: "laydown",
        polygon_wgs84: [],
        polygon_site: [
          [0, 0],
          [4, 0],
          [4, 3],
        ],
        created_at: "2026-09-01T00:00:00Z",
      } as never,
    ]);
    const { workspace } = renderTopic(FindingsTopic);
    const view = fakeView();
    act(() => workspace.getState().setViewApi(view));
    fireEvent.click(screen.getByRole("option", { name: "Yard" }));
    expect(workspace.getState().selection).toEqual({ kind: "zone", id: "z1" });
    expect(view.fit).toHaveBeenCalledWith([0, 0, 4, 3]);
  });

  it("Measure holds distance, area, profile, volume, and lists measurements by kind", () => {
    useMeasurementsStore.getState().set(
      [
        {
          id: "a",
          kind: "distance",
          name: "Fence run",
          vertices_site: [
            [0, 0],
            [2, 2],
          ],
        } as never,
        {
          id: "b",
          kind: "area",
          name: "Pad",
          vertices_site: [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
        } as never,
      ],
      false,
    );
    renderTopic(MeasureTopic);
    expect(screen.getByRole("group", { name: "Measure tools" }).querySelectorAll("button")).toHaveLength(4);
    expect(screen.getByRole("option", { name: "Fence run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide measure" })).toBeInTheDocument();
  });

  it("AI holds detect region, Run on the whole map and the review filters, no survey switch", () => {
    renderTopic(AiTopic);
    expect(screen.getByRole("button", { name: /AI detect region/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Pending")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "All surveys" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run on the whole map" }));
    expect(useRasterActions.getState().current).toMatchObject({
      type: "run",
      row: { kind: "map", id: "m1" },
    });
  });

  it("AI lists the review queue, pending first", () => {
    useDetectStore
      .getState()
      .remember("run1", [
        { id: "d1", review_state: "accepted", class_id: "c", confidence: 0.91 } as never,
        { id: "d2", review_state: "unreviewed", class_id: "c", confidence: 0.42 } as never,
      ]);
    useDetectStore.getState().setInView("run1", ["d1", "d2"]);
    const { workspace } = renderTopic(AiTopic);
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Detection42 %", "Detection91 %"]);
    fireEvent.click(options[0]);
    expect(workspace.getState().selection).toEqual({ kind: "detection", id: "run1.d2" });
    expect(renderHook(() => usePendingCount()).result.current).toBe(1);
  });

  it("Drawings: one import action, Align disabled without a selected drawing, no duplicate menu entries", () => {
    renderTopic(DrawingsTopic, { drawing: true });
    expect(screen.getAllByRole("button", { name: /Import drawing/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Align drawing — Choose a drawing first/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /actions$/ }));
    expect(screen.getByRole("menuitem", { name: /Properties/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Align|Knock out white|Layers…/ })).toBeNull();
  });

  it("Layers: base and elevation only, one import menu without drawings", () => {
    renderTopic(LayersTopic, { drawing: true });
    expect(screen.queryByRole("region", { name: "Annotations" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Drawings" })).toBeNull();
    expect(screen.getByRole("region", { name: "Base maps" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a layer" }));
    expect(screen.getByRole("menuitem", { name: /Import orthomosaic/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Import drawing/ })).toBeNull();
  });
});
