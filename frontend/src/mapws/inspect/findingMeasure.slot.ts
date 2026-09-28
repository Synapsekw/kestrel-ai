import type { InspectorSlot } from "@/mapws/annotations/bindings";
import { FindingMeasure } from "@/mapws/findings/FindingMeasure";

/** W3-4: W1's finding inspector renders this under F's "Measured size". */
const findingMeasure: InspectorSlot = {
  id: "finding.measure",
  Component: FindingMeasure,
};

export default findingMeasure;
