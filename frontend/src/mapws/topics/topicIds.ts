/** Spec §2: the map rail, shared topics first. */
export const MAP_TOPICS = ["layers", "findings", "measure", "ai", "drawings"] as const;
export type MapTopicId = (typeof MAP_TOPICS)[number];
