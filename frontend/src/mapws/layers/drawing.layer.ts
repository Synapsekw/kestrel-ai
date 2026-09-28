import type { LayerKind } from "./layerRegistry";
import { DrawingMount } from "../drawings/DrawingMount";
import { drawingRowMenu, drawingRows } from "../drawings/drawingRows";

/** W5's layer plugin (W1 plugin discovery): the Drawings group, spec §5.2 and §8.4. */
const drawingLayer: LayerKind = {
  id: "drawing",
  group: "drawings",
  icon: "drawing",
  rows: drawingRows,
  Mount: DrawingMount,
  menu: drawingRowMenu,
};

export default drawingLayer;
