/** The asset workspace's rail topics (asset findings spec §9), the model panel first. */
export const MODEL_TOPICS = ["model", "findings", "photos"] as const;
export type ModelTopicId = (typeof MODEL_TOPICS)[number];
