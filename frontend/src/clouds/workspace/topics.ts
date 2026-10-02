import type { CloudToolId } from "./tools";

/** Spec §2/§3.2: the cloud rail, shared topics first. */
export const CLOUD_TOPICS = ["layers", "findings", "measure", "clip", "photos"] as const;
export type CloudTopicId = (typeof CLOUD_TOPICS)[number];

export const TOPIC_OF_TOOL: Record<CloudToolId, CloudTopicId | "nav"> = {
  orbit: "nav",
  pan: "nav",
  fly: "nav",
  point: "measure",
  distance: "measure",
  height: "measure",
  vertical: "measure",
  area: "measure",
  section: "measure",
  clip: "clip",
  pin: "findings",
  photo: "photos",
};
