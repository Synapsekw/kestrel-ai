import Feature from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import type { VolumeMeasurement } from "@contract/client";
import type { VolumeMeasurementPatch } from "@/api/volumes";
import { SELECTION_PROP } from "@/mapws/w4host";
import { volumeSelection } from "./volumeModel";

export type VolumeRole = "measure" | "stable" | "exclusion" | "footprint";

export const closeRing = (ring: number[][]): number[][] => [...ring, ring[0]];

export function openRing(coords: number[][]): number[][] {
  const [a, b] = [coords[0], coords[coords.length - 1]];
  return coords.length > 1 && a[0] === b[0] && a[1] === b[1] ? coords.slice(0, -1) : coords;
}

function ringFeature(role: VolumeRole, ring: number[][], props: Record<string, unknown> = {}): Feature {
  const f = new Feature(new Polygon([closeRing(ring)]));
  f.setProperties({ role, ...props });
  return f;
}

/** A measurement's polygon in site coordinates; W1's Select tool opens it through SELECTION_PROP. */
export function volumeFeature(id: string, ring: number[][], selected: boolean): Feature {
  const f = ringFeature("measure", ring, { selected });
  f.set(SELECTION_PROP, volumeSelection(id));
  f.setId(id);
  return f;
}

/** The selected measurement's footprints (site), exclusions and stable area (native = site only in the identity frame). */
export function maskFeatures(m: VolumeMeasurement, footprints: number[][][], identity: boolean): Feature[] {
  return [
    ...footprints.map((r) => ringFeature("footprint", r)),
    ...(identity
      ? m.masks.exclusion_polygons.map((e) =>
          ringFeature("exclusion", e.ring, { mode: e.mode, maskId: e.id }),
        )
      : []),
    ...(identity && m.alignment.stable_polygon ? [ringFeature("stable", m.alignment.stable_polygon)] : []),
  ];
}

/** The masks patch that appends one exclusion (mode "patch") and keeps the existing ones. */
export function withExclusion(m: VolumeMeasurement, ring: number[][], id: string): VolumeMeasurementPatch {
  return {
    masks: {
      exclusion_polygons: [...m.masks.exclusion_polygons, { id, ring, mode: "patch" }],
    },
  };
}
