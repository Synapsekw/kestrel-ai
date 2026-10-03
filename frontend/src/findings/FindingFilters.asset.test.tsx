import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_SEVERITY_SCALE } from "@/ui";
import { ASSET_MODEL_ID, exampleAssetModel } from "@/test/assetFindingFixtures";
import { exampleSummary, projectTypes } from "@/test/findingFixtures";
import { DEFAULT_FILTERS, type FindingFilters } from "./filters";
import { FindingFiltersBar } from "./FindingFilters";

function bar(filters: FindingFilters, assetModels = [exampleAssetModel]) {
  const onChange = vi.fn();
  render(
    <FindingFiltersBar
      filters={filters}
      summary={exampleSummary}
      scale={DEFAULT_SEVERITY_SCALE}
      types={projectTypes}
      assetModels={assetModels}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("FindingFiltersBar asset filters", () => {
  it("shows no asset chip, sort or row without asset models", () => {
    bar(DEFAULT_FILTERS, []);
    expect(screen.queryByRole("button", { name: "Asset" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Asset filters" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Sort: Height" })).not.toBeInTheDocument();
  });

  it("toggles the Asset source and offers the height and zone sorts", () => {
    const onChange = bar(DEFAULT_FILTERS);
    fireEvent.click(screen.getByRole("button", { name: "Asset", pressed: false }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, source: ["asset"] });
    expect(screen.getByRole("option", { name: "Sort: Height" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Sort: Zone" })).toBeInTheDocument();
  });

  it("picks a model, which clears the zone and side picks", () => {
    const onChange = bar({ ...DEFAULT_FILTERS, zone: ["x"], side: ["y"] });
    fireEvent.change(screen.getByRole("combobox", { name: "Asset model" }), {
      target: { value: ASSET_MODEL_ID },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_FILTERS,
      assetModelId: ASSET_MODEL_ID,
      zone: [],
      side: [],
    });
  });

  it("offers the chosen model's zones and sides as chips", () => {
    const onChange = bar({ ...DEFAULT_FILTERS, assetModelId: ASSET_MODEL_ID, zone: ["head"] });
    const zones = screen.getByRole("group", { name: "Zone" });
    expect(
      within(zones)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Head", "Shaft", "Base"]);
    expect(within(zones).getByRole("button", { name: "Head" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(zones).getByRole("button", { name: "Shaft" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ zone: ["head", "shaft"], assetModelId: ASSET_MODEL_ID }),
    );
    const sides = screen.getByRole("group", { name: "Side" });
    fireEvent.click(within(sides).getByRole("button", { name: "SW" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ side: ["SW"] }));
  });

  it("filters by placement", () => {
    const onChange = bar(DEFAULT_FILTERS);
    const row = screen.getByRole("group", { name: "Asset filters" });
    fireEvent.click(within(row).getByRole("radio", { name: "Unplaced" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, placed: "unplaced" });
  });

  it("Clear filters keeps the sort and the view", () => {
    const onChange = bar({ ...DEFAULT_FILTERS, zone: ["head"], sort: "-height", view: "gallery" });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, sort: "-height", view: "gallery" });
  });
});
