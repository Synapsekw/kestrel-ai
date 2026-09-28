import type { Look } from "./detectModel";

/** Colours are "token:<name>" (read with tokenColour at draw time) or a catalogue hex. */
export interface LookStyle {
  stroke: string;
  width: number;
  dash: number[] | null;
  fill: string;
  fillAlpha: number;
  label: boolean;
}

export function lookStyle(look: Look, classColour: string | undefined): LookStyle | null {
  const cls = classColour ?? "token:accent";
  switch (look) {
    case "hidden":
      return null;
    case "selected":
      return {
        stroke: "token:accent",
        width: 3,
        dash: null,
        fill: "token:accent",
        fillAlpha: 0.12,
        label: true,
      };
    case "pending-defect":
      return {
        stroke: "token:accent",
        width: 2,
        dash: [6, 4],
        fill: "token:accent",
        fillAlpha: 0.08,
        label: true,
      };
    case "accepted-defect":
      return {
        stroke: "token:ok",
        width: 2,
        dash: null,
        fill: "token:ok",
        fillAlpha: 0.08,
        label: true,
      };
    case "rejected":
      return {
        stroke: "token:dim",
        width: 1.5,
        dash: [2, 4],
        fill: "token:dim",
        fillAlpha: 0,
        label: false,
      };
    case "object":
    case "object-accepted":
      return {
        stroke: cls,
        width: 2,
        dash: null,
        fill: cls,
        fillAlpha: 0.08,
        label: true,
      };
  }
}

/** "Excavator 0.96": the box label (spec §9.3). */
export function tagText(name: string | undefined, confidence: number): string {
  return `${name ?? "Unknown"} ${confidence.toFixed(2)}`;
}
