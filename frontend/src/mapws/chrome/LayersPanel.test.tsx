import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { registerLayerKind, type LayerRow } from "../layers/layerRegistry";
import { renderInWorkspace } from "../test/harness";
import { LayersPanel } from "./LayersPanel";

const offs: (() => void)[] = [];
afterEach(() => offs.splice(0).forEach((off) => off()));

const Mount = () => null;
const row = (id: string, date: string | null, extra: Partial<LayerRow> = {}): LayerRow => ({
  key: `ortho:${id}`,
  kind: "ortho",
  group: "base",
  id,
  name: `Orthomosaic ${id}`,
  meta: "3.0 cm",
  date,
  ...extra,
});

function setup(rows: LayerRow[], notInCompare = new Set<string>()) {
  offs.push(
    registerLayerKind({
      id: "ortho",
      group: "base",
      icon: "map",
      rows: () => [],
      Mount,
      menu: (r) => [{ id: "rename", label: `Rename ${r.name}`, onSelect: () => {} }],
    }),
  );
  return renderInWorkspace(<LayersPanel rows={rows} notInCompare={notInCompare} projectId="p1" />).stores;
}

describe("LayersPanel (spec §5.2)", () => {
  it("lists rows under their group eyebrow with the count", () => {
    setup([row("sep", "2026-09-14"), row("aug", "2026-08-14")]);
    const panel = screen.getByRole("region", { name: "Layers" });
    expect(within(panel).getByText("Base maps")).toBeInTheDocument();
    expect(within(panel).getByText("2")).toBeInTheDocument();
    expect(within(panel).getByText("Orthomosaic sep")).toBeInTheDocument();
    expect(within(panel).getByText("Drawings")).toBeInTheDocument(); // always, with its Import button
  });

  it("hides and shows a row, and sets its opacity", () => {
    const stores = setup([row("sep", "2026-09-14")]);
    fireEvent.click(screen.getByRole("button", { name: "Hide Orthomosaic sep" }));
    expect(stores.workspace.getState().layerState["ortho:sep"]).toEqual({
      visible: false,
      opacity: 100,
    });
    expect(screen.getByRole("button", { name: "Show Orthomosaic sep" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const slider = screen.getByRole("slider", {
      name: "Orthomosaic sep opacity",
    });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(stores.workspace.getState().layerState["ortho:sep"].opacity).toBeLessThan(100);
  });

  it("reorders within the group from the keyboard", () => {
    const stores = setup([row("sep", "2026-09-14"), row("aug", "2026-08-14")]);
    fireEvent.keyDown(screen.getByRole("button", { name: "Move Orthomosaic aug" }), { key: "ArrowUp" });
    expect(stores.workspace.getState().order.base).toEqual(["ortho:aug", "ortho:sep"]);
  });

  it("marks a dated row that is not in the compare", () => {
    setup([row("jul", "2026-07-01")], new Set(["ortho:jul"]));
    expect(screen.getByRole("button", { name: "Hide Orthomosaic jul" })).toHaveAccessibleDescription(
      "Not in compare",
    );
  });

  it("greys a map with no coordinates and links to the evaluation view (spec §14)", () => {
    setup([
      row("raw", null, {
        kind: "map_nocrs",
        key: "map_nocrs:raw",
        name: "Scan.tif",
        unavailable: {
          reason: "no coordinates — open in evaluation view",
          href: "/p/p1/maps/raw/evaluate",
          linkLabel: "Open in evaluation view",
        },
      }),
    ]);
    expect(screen.getByText("no coordinates — open in evaluation view")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in evaluation view" })).toHaveAttribute(
      "href",
      "/p/p1/maps/raw/evaluate",
    );
    expect(screen.queryByRole("slider", { name: "Scan.tif opacity" })).toBeNull();
  });

  it("collapses from the header", () => {
    const stores = setup([row("sep", "2026-09-14")]);
    fireEvent.click(screen.getByRole("button", { name: "Collapse layers" }));
    expect(stores.workspace.getState().layersCollapsed).toBe(true);
    expect(screen.queryByText("Orthomosaic sep")).toBeNull();
  });
});
