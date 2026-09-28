import type { CloudMeasurement } from "@/api/cloudMeasurements";
import { overlayShapes, type MeasureKind } from "../measure";
import type { CaptureMark } from "../viewer/capture";
import type { OverlayShape } from "../viewer/overlay";
import type { Vec3 } from "../viewer/types";

/** A finding is V2's accent pin sprite at its anchor (never the severity colour, spec §7). */
export function findingMarks(anchor: Vec3): CaptureMark[] {
  return [{ kind: "finding", at: [anchor[0], anchor[1], anchor[2]] }];
}

export function measurementPoints(m: CloudMeasurement): Vec3[] {
  return m.points.map((p) => [p.x, p.y, p.z]);
}

/** A measurement is its overlay geometry (spec §7 Capture step 3). */
export function measurementMarks(m: CloudMeasurement): CaptureMark[] {
  const pts = m.points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  const dots: OverlayShape = { kind: "points", points: pts, tone: "accent" };
  let shapes: OverlayShape[];
  if (m.kind === "area") shapes = [dots, { kind: "line", points: pts, closed: true, tone: "accent" }];
  else if (m.kind === "profile") shapes = [dots, { kind: "line", points: pts.slice(0, 2), tone: "accent" }];
  else if (m.kind === "vertical" && m.params?.method === "rings") shapes = [dots];
  else shapes = overlayShapes(m.kind as MeasureKind, m.points, null);
  return [{ kind: "measurement", shapes }];
}
