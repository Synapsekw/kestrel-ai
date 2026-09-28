import type { LayerKind } from "@/mapws/annotations/bindings";
import { FindingsLayer } from "@/mapws/findings/FindingsLayer";
import { FindingsRowExtra } from "@/mapws/findings/FindingsRowExtra";
import { findingsRows } from "@/mapws/findings/tooltip";

/** Spec §5.2 Annotations › Findings (W3-1, §9.4). */
const findings: LayerKind = {
  id: "findings",
  group: "annotations",
  icon: "findings",
  rows: findingsRows,
  Mount: FindingsLayer,
  RowExtra: FindingsRowExtra,
};

export default findings;
