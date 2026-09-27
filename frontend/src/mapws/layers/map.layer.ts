import type { LayerKind } from "./layerRegistry";
import { rasterMenu } from "./rasterMenu";
import { baseMapRows } from "./rasterRows";
import { RasterMount } from "./RasterMount";

/** M §5.2 Base maps (a plugin W1 discovers, R-W1-1). */
const mapKind: LayerKind = {
  id: "map",
  group: "base",
  icon: "map",
  rows: baseMapRows,
  Mount: RasterMount,
  menu: rasterMenu,
};

export default mapKind;
