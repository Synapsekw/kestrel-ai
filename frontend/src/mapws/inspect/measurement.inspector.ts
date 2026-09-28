import type { InspectorKind } from "@/mapws/annotations/bindings";
import { removeMeasurement } from "@/mapws/measure/actions";
import { MeasurementInspector } from "@/mapws/measure/MeasurementInspector";

/**
 * Spec §5.3 "Distance / area" and "Profile", in W1's framed 318 px glass (W3-14 for `Del`). W1's
 * dialog title already asks "Delete this measurement?", so the confirm line only adds the rest (A17).
 */
const measurement: InspectorKind = {
  id: "measurement",
  label: "Measurement",
  framed: true,
  Body: MeasurementInspector,
  remove: {
    confirm: () => "This cannot be undone.",
    run: (sel, { api, projectId }) => removeMeasurement(api, projectId, sel.id),
  },
};

export default measurement;
