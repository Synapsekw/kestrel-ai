import type { SurveyTimeline } from "@/api/surveys";

/** Toggles for the chart's classes; a hollow swatch is a hidden class. */
export function ClassLegend({
  classes,
  hidden,
  onToggle,
}: {
  classes: SurveyTimeline["classes"];
  hidden: Set<string>;
  onToggle: (classId: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-3">
      {classes.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onToggle(c.id)}
          aria-pressed={!hidden.has(c.id)}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"
        >
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full"
            style={{
              backgroundColor: hidden.has(c.id) ? "transparent" : c.colour,
              boxShadow: `inset 0 0 0 2px ${c.colour}`,
            }}
          />
          {c.name}
        </button>
      ))}
    </div>
  );
}
