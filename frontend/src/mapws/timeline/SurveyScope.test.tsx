import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDetectStore } from "@/mapws/detect/detectStore";
import { DEFAULT_FILTERS } from "@/mapws/detect/detectModel";
import { makeStores, renderHookInWorkspace, renderInWorkspace } from "@/mapws/test/harness";
import { SurveyScope, useSurveyScope } from "./SurveyScope";

afterEach(() => useDetectStore.setState({ filters: DEFAULT_FILTERS }));

describe("useSurveyScope", () => {
  it("one switch drives findings and detections", () => {
    const { result, workspace } = renderHookInWorkspace(() => useSurveyScope());
    act(() => result.current.set(true));
    expect(useDetectStore.getState().filters.allSurveys).toBe(true);
    expect(workspace.getState().layerState["findings:all"]?.style?.allSurveys).toBe(true);
    expect(result.current.all).toBe(true);
  });

  it("keeps the findings row's other filters and its visibility", () => {
    const { result, workspace } = renderHookInWorkspace(() => useSurveyScope());
    act(() =>
      workspace.getState().setLayerState("findings:all", { visible: false, style: { statuses: ["open"] } }),
    );
    act(() => result.current.set(true));
    expect(workspace.getState().layerState["findings:all"]).toMatchObject({
      visible: false,
      style: { statuses: ["open"], allSurveys: true },
    });
  });

  it("on open, the persisted findings scope sets the detections' scope", () => {
    const stores = makeStores();
    stores.workspace.getState().setLayerState("findings:all", { style: { allSurveys: true } });
    renderInWorkspace(<SurveyScope />, { stores });
    expect(useDetectStore.getState().filters.allSurveys).toBe(true);
    expect(screen.getByRole("switch", { name: "All surveys" })).toHaveAttribute("aria-checked", "true");
  });

  it("renders one 'All surveys' switch", () => {
    renderInWorkspace(<SurveyScope />);
    const sw = screen.getByRole("switch", { name: "All surveys" });
    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
  });
});
