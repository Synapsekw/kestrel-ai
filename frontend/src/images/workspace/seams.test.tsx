import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Box } from "@contract/client";
import { personBox, proposalBox } from "@/test/fixtures";
import * as seams from "./seams";

const ws = () => seams.useImagesWorkspace.getState();

beforeEach(() => act(() => ws().reset()));

describe("seams over FC's store", () => {
  it("selects one shape; a focused suggestion wins", () => {
    // FC's setBoxes keeps only the loaded image's boxes.
    act(() => seams.useImagesWorkspace.setState({ imageId: personBox.image_id }));
    act(() => ws().setBoxes([{ ...personBox, id: "a" } as Box, { ...proposalBox, id: "s" } as Box]));
    const { result } = renderHook(() => seams.useSelection());
    act(() => result.current.select("a"));
    expect(ws().selectedIds).toEqual(["a"]);
    expect(result.current.selectedId).toBe("a");
    act(() => ws().focusSuggestion("s"));
    expect(result.current.selectedId).toBe("s");
    act(() => result.current.select(null));
    expect(ws().selectedIds).toEqual([]);
  });

  it("maps saving and a failure with its retry", () => {
    const { result } = renderHook(() => seams.useSaveState());
    expect(result.current.state).toBe("saved");
    act(() => ws().beginRequest());
    expect(result.current.state).toBe("saving");
    let retried = false;
    act(() => {
      ws().endRequest();
      ws().fail("draw box failed", () => (retried = true));
    });
    expect(result.current.state).toBe("failed");
    act(() => result.current.retry());
    expect(retried).toBe(true);
  });

  it("links boxes to findings through FC's store", () => {
    const { result } = renderHook(() => seams.useFindingLinks());
    act(() => result.current.linkFindings({ b1: "f1" }));
    expect(result.current.findingOf).toEqual({ b1: "f1" });
  });

  it("re-exports FC's, FB's and FA's parts", () => {
    for (const name of [
      "ImageCanvas",
      "ToolPalette",
      "ZoomCluster",
      "useImageData",
      "useCommandContext",
      "useCanvasKeyHandlers",
      "useImagesKeymap",
      "useHeldKeys",
      "statusHintsFor",
      "measureShape",
      "scaleFromCamera",
      "lengthLabel",
      "useImageIndex",
      "indexNeighbours",
      "applyPreset",
      "BrowserFilters",
      "BrowserGrid",
      "BrowserSelectionBar",
      "Filmstrip",
      "CaptureMap",
      "MiniMap",
      "useAiWorkspace",
      "AiBar",
      "HintBar",
      "SuggestionChip",
      "SmartPolygonPanel",
      "SamWarmEdge",
      "ModelMenu",
      "SuggestionsLayer",
      "BatchDetectDialog",
      "BatchDetectWatch",
      "AiHosts",
      "AiDetectButton",
      "ensureAiRegistered",
      "batchScopeOf",
    ] as const) {
      expect(typeof seams[name], name).toMatch(/function|object/);
    }
  });
});

describe("batchScopeOf", () => {
  const defaults = seams.DEFAULT_BROWSER_FILTERS;

  it("sends a selection as ids", () => {
    expect(seams.batchScopeOf(defaults, ["a", "b"], 900)).toEqual({
      scope: { image_ids: ["a", "b"] },
      scopeLabel: "2 selected",
      scopeCount: 2,
    });
  });

  it("sends a flight filter as its source", () => {
    const r = seams.batchScopeOf({ ...defaults, sourceId: "src-1" }, null, 312);
    expect(r).toEqual({ scope: { source_id: "src-1" }, scopeLabel: "This flight", scopeCount: null });
  });

  it("a flight plus other filters sends the filter, source included, with the filtered count (I4)", () => {
    const r = seams.batchScopeOf(
      { ...defaults, sourceId: "src-1", unlabeled: true, severities: [3] },
      null,
      41,
    );
    expect(r).toEqual({
      scope: { filter: { source_id: "src-1", unlabeled: true, severity: [3] } },
      scopeLabel: "41 images in this flight",
      scopeCount: 41,
    });
  });

  it("a flight with only a different sort still sends the source (sorting narrows nothing)", () => {
    const r = seams.batchScopeOf({ ...defaults, sourceId: "src-1", sort: "path", order: "desc" }, null, 312);
    expect(r).toEqual({ scope: { source_id: "src-1" }, scopeLabel: "This flight", scopeCount: null });
  });

  it("sends other filters as the contract's ImageFilter (arrays, booleans; no sort)", () => {
    const r = seams.batchScopeOf(
      {
        ...defaults,
        hasSuggestions: true,
        severities: [2, 4],
        findingStatus: "open",
        typeIds: ["t2", "t1"],
        reviewed: "no",
        search: "  DJI_01 ",
      },
      [],
      57,
    );
    expect(r).toEqual({
      scope: {
        filter: {
          has_suggestions: true,
          severity: [4, 2],
          finding_status: ["open"],
          type_ids: ["t1", "t2"],
          reviewed: false,
          search: "DJI_01",
        },
      },
      scopeLabel: "57 images",
      scopeCount: 57,
    });
  });
});
