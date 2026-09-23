import type { SurveyTimeline } from "@/api/surveys";

export type Dot = { x: number; y: number; comparable: boolean };
export type Line = { classId: string; name: string; colour: string; points: string; dots: Dot[] };

const PAD = 8;

/** Survey rows to SVG coordinates: oldest on the left, the highest count at the top. */
export function chartLines(timeline: SurveyTimeline, size: { w: number; h: number }): Line[] {
  const surveys = timeline.surveys;
  const top = Math.max(1, ...surveys.flatMap((s) => Object.values(s.counts)));
  const stepX = surveys.length > 1 ? (size.w - 2 * PAD) / (surveys.length - 1) : 0;
  return timeline.classes.map((c) => {
    const dots = surveys.map((s, i) => ({
      x: PAD + i * stepX,
      y: size.h - PAD - ((s.counts[c.id] ?? 0) / top) * (size.h - 2 * PAD),
      comparable: s.state === "ok",
    }));
    return {
      classId: c.id,
      name: c.name,
      colour: c.colour,
      points: dots.map((d) => `${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(" "),
      dots,
    };
  });
}
