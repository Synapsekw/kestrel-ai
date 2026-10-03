import type { Finding } from "@/api/findings";
import type { IconName } from "@/ui";

/** Keyed by the anchor kind, so a new kind fails to compile here rather than render blank. */
type AnchorKind = Finding["anchor"]["kind"];

const SOURCE_ICON: Record<AnchorKind, IconName> = {
  image: "images",
  map: "map",
  cloud: "cloud",
  asset: "cube",
};

export const SOURCE_LABEL: Record<AnchorKind, string> = {
  image: "Images",
  map: "Map",
  cloud: "Point cloud",
  asset: "Asset model",
};

export interface FindingLocation {
  icon: IconName;
  primary: string;
  secondary: string | null;
}

/**
 * The data item's label (from the Data list), plus the photo's file name when the anchor carries
 * one. Read structurally so a `file_name` added to the image anchor shows without a change here.
 */
export function findingLocation(
  f: Pick<Finding, "anchor" | "data_id">,
  labels: ReadonlyMap<string, string>,
): FindingLocation {
  const kind = f.anchor.kind;
  const anchor: object = f.anchor;
  const fileName = "file_name" in anchor && typeof anchor.file_name === "string" ? anchor.file_name : null;
  const label = f.data_id ? labels.get(f.data_id) : undefined;
  return { icon: SOURCE_ICON[kind], primary: label ?? SOURCE_LABEL[kind], secondary: fileName };
}
