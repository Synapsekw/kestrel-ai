import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LayerKind, LayerRow } from "../layers/layerRegistry";
import { rasterMenu } from "../layers/rasterMenu";
import { baseMapRows, elevationRows } from "../layers/rasterRows";
import { drawingRowMenu } from "../drawings/drawingRows";
import { mapLayer, surfaceLayer, SEP } from "../test/rasterFixtures";
import { LayerRowView } from "./LayerRowView";

const state = { visible: true, opacity: 100 };
const [ortho] = baseMapRows({ layers: [mapLayer("sep", SEP)] });
const [dem] = elevationRows({ layers: [surfaceLayer("dem", SEP, "dem")] }); // name is "dem"
const drawing: LayerRow = {
  key: "drawing:d1",
  kind: "drawing",
  group: "drawings",
  id: "d1",
  name: "foundation-plan",
  meta: "",
  date: null,
};

function show(row: LayerRow, kind: LayerKind) {
  return render(
    <LayerRowView
      row={row}
      kind={kind}
      state={state}
      notInCompare={false}
      onState={vi.fn()}
      onMove={vi.fn()}
      onDropOn={vi.fn()}
    />,
  );
}

const kind = (id: string, menu: LayerKind["menu"]): LayerKind => ({
  id,
  group: "base",
  icon: "trash",
  rows: () => [],
  menu,
});

describe("LayerRowView delete", () => {
  it("shows a trash icon on an orthophoto, an elevation row and a drawing, and not on a row without delete", () => {
    for (const [row, rowKind, name] of [
      [ortho, kind("map", rasterMenu), `Delete ${ortho.name}`],
      [dem, kind("surface", rasterMenu), "Delete dem"],
      [drawing, kind("drawing", drawingRowMenu), "Delete foundation-plan"],
    ] as const) {
      const view = show(row, rowKind);
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
      view.unmount();
    }
    show(
      drawing,
      kind("note", () => [{ id: "style", label: "Style", onSelect: () => {} }]),
    );
    expect(screen.queryByRole("button", { name: "Delete foundation-plan" })).toBeNull();
  });

  it("the trash calls the menu's delete action and does not remove the row menu", async () => {
    const onSelect = vi.fn();
    show(
      drawing,
      kind("drawing", () => [{ id: "delete", label: "Delete…", onSelect }]),
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete foundation-plan" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "foundation-plan actions" })).toBeInTheDocument();
  });
});
