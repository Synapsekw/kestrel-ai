import type { CloudViewOut } from "@contract/client";
import type { CloudMeasurement } from "@/api/cloudMeasurements";
import type { Finding } from "@/api/findings";
import type { Vec3 } from "../viewer/types";
import type { ViewSubject } from "../workspace/seams";
import type { SubjectGeometry } from "./queue";

export interface MissingItem {
  subject: ViewSubject;
  geometry: SubjectGeometry;
}

/** The finding's cloud anchor as a point, when it is anchored on this cloud. */
export function findingAnchor(f: Finding, cloudId: string): Vec3 | null {
  const a = f.anchor;
  return a.kind === "cloud" && a.cloud_id === cloudId ? [a.x, a.y, a.z] : null;
}

/** Spec §11.3 "Capture missing views": every subject with no view or a stale one; findings first. */
export function missingSubjects(
  cloudId: string,
  findings: Finding[],
  measurements: CloudMeasurement[],
  views: CloudViewOut[],
): MissingItem[] {
  const byKey = new Map(views.map((v) => [`${v.subject_kind}:${v.subject_id}`, v]));
  const needs = (key: string) => {
    const v = byKey.get(key);
    return !v || v.stale;
  };
  const out: MissingItem[] = [];
  for (const f of findings) {
    const anchor = findingAnchor(f, cloudId);
    if (anchor && needs(`finding:${f.id}`))
      out.push({ subject: { kind: "finding", id: f.id }, geometry: { kind: "finding", anchor } });
  }
  for (const m of measurements)
    if (needs(`cloud_measurement:${m.id}`))
      out.push({
        subject: { kind: "cloud_measurement", id: m.id },
        geometry: { kind: "cloud_measurement", measurement: m },
      });
  return out;
}
