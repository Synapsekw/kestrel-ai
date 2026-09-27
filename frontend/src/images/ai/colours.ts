/**
 * Konva draws on a canvas and cannot use Tailwind classes; it reads the same RGB-triplet tokens
 * as the rest of the app. I-FC hand-off (drift.md G2): re-export the canvas layer's colour
 * helpers instead of copying them, so there is one implementation of `tokenColour`/`withAlpha`.
 */
export { tokenColour, withAlpha } from "@/images/canvas/colours";
