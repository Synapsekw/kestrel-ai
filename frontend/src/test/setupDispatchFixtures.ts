import type { components } from "@contract/client";
import { emptyDraft, type DraftBucket, type DraftType, type SetupDraft } from "@/setup/draftStore";

type S = components["schemas"];

/** A DJI M30T folder: its `_V` and `_T` photos land side by side. */
export const PHOTOS = "E:\\Delivery\\DCIM\\100MEDIA";

const ACCEPTS: Record<S["SlotRoute"], string[]> = {
  images: ["jpg", "jpeg"], // U3 lists .dng as Not recognised: the importer cannot read it
  map: ["tif", "tiff"],
  elevation: ["tif", "tiff"],
  pointcloud: ["las", "laz"],
  drawing: ["pdf", "dxf", "xml"],
  video: ["mp4", "mov"],
};

export function slot(
  key: string,
  label: string,
  route: S["SlotRoute"],
  match: S["SlotMatch"] | null = null,
): S["TemplateSlot"] {
  return { key, label, route, required: false, accepts: ACCEPTS[route], match };
}

/** The Vertical asset inspection slots (spec §5.1). */
export const VERTICAL_SLOTS: S["TemplateSlot"][] = [
  slot("visual", "Visual photos", "images"),
  slot("thermal", "Thermal photos", "images", { thermal: true }),
  slot("pointcloud", "3D point cloud", "pointcloud"),
  slot("drawings", "Asset drawings", "drawing"),
];

let next = 0;
export function bucket(patch: Partial<DraftBucket> & Pick<DraftBucket, "route">): DraftBucket {
  next += 1;
  return {
    id: `b${next}`,
    skipped: false,
    match: {},
    slot_key: null,
    folder: PHOTOS,
    files: [],
    count: 1,
    bytes: 1000,
    samples: [],
    crs: null,
    ...patch,
  };
}

export function draftType(name: string, hotkey: string | null, patch: Partial<DraftType> = {}): DraftType {
  return {
    key: `k-${name}`,
    name,
    kind: "defect",
    colour: "#ff9c3a",
    default_severity: 2,
    hotkey,
    definition: `${name} as seen from the drone.`,
    severity_rules: [],
    ...patch,
  };
}

export function draft(patch: Partial<SetupDraft> = {}): SetupDraft {
  return {
    ...emptyDraft(),
    templateId: "builtin-vertical",
    name: "Tower 14",
    folder: "E:\Projects\Tower 14",
    slots: VERTICAL_SLOTS,
    ...patch,
  };
}
