import type { Finding } from "@/api/findings";
import type { Vec3 } from "@/clouds/viewer/types";

/** A cloud finding as the pins layer and the Findings tab need it (spec §9.1). */
export interface CloudPin {
  id: string;
  number: number;
  typeId: string;
  severity: number | null;
  status: Finding["status"];
  note: string;
  /** The anchor `x, y, z` in the cloud's native CRS. */
  p: Vec3;
  /** `uncertainty_m` at pick time. */
  u: number | null;
  /** Unit surface normal, or null (then never dimmed by the facing test). */
  normal: Vec3 | null;
}

/** The pin tool's unsaved pin (§9.4): nothing is persisted until Create. */
export interface DraftPin {
  p: Vec3;
  u: number | null;
  normal: Vec3 | null;
}

/** What one pin element shows. `id` is the finding id, or `DRAFT_ID` for the draft. */
export interface PinView {
  id: string;
  p: Vec3;
  normal: Vec3 | null;
  u: number | null;
  colour: string;
  label: string;
  ariaLabel: string;
  draft: boolean;
}

export const DRAFT_ID = "draft";
