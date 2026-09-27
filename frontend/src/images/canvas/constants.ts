/** Konva layer names (spec §9.1); E's perf harness finds the layers by these names. */
export const LAYER_NAMES = {
  image: "image",
  annotations: "annotations",
  suggestions: "suggestions",
  interaction: "interaction",
} as const;

/** Layers 2 and 3 start listening again this long after the last wheel or drag event. */
export const IDLE_AFTER_MS = 120;

/** A label shows on a shape at least this many screen px tall (or on the selected/hovered one). */
export const LABEL_MIN_PX = 48;
