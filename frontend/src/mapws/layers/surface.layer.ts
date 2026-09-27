import { ElevationStyle } from "./ElevationStyle";
import type { LayerKind } from "./layerRegistry";
import { rasterMenu } from "./rasterMenu";
import { elevationRows } from "./rasterRows";
import { RasterMount } from "./RasterMount";

/** M §5.2 Elevation (a plugin W1 discovers). Hidden until the operator shows it. */
const surfaceKind: LayerKind = {
  id: "surface",
  group: "elevation",
  icon: "elevation",
  rows: elevationRows,
  Mount: RasterMount,
  menu: rasterMenu,
  RowExtra: ElevationStyle,
  defaultVisible: false,
};

export default surfaceKind;
