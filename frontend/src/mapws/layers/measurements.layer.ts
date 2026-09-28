import type { LayerKind } from "@/mapws/annotations/bindings";
import { measurementsRows } from "@/mapws/measure/layerFeatures";
import { MeasurementLayer } from "@/mapws/measure/MeasurementLayer";
import { MeasurementRowExtra } from "@/mapws/measure/MeasurementRowExtra";

/** Spec §5.2 Annotations › Measurements (W3-1). */
const measurements: LayerKind = {
  id: "measurements",
  group: "annotations",
  icon: "measure",
  rows: measurementsRows,
  Mount: MeasurementLayer,
  RowExtra: MeasurementRowExtra,
};

export default measurements;
