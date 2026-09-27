import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  GlassPanel,
  Icon,
  Menu,
  Segmented,
  Slider,
  Tooltip,
  cx,
  focusRing,
  toast,
  transition,
  type SegmentedOption,
} from "@/ui";
import { useWorkspace } from "../context";
import { canCompare, flownDates } from "../state/surveys";
import { formatSurveyDate, pickDate } from "../timeline/timelineModel";
import type { CompareMode } from "../types";

const OPTIONS: SegmentedOption<CompareMode>[] = [
  { value: "single", label: "Single" },
  { value: "swipe", label: "Swipe" },
  { value: "side", label: "Side-by-side" },
  { value: "blend", label: "Blend" },
];

function DateChip({
  which,
  label,
  date,
  dates,
  onPick,
}: {
  which: "l" | "r";
  label: string;
  date: string | null;
  dates: readonly string[];
  onPick: (date: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${formatSurveyDate(date)}`}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "inline-flex h-7 items-center gap-1.5 rounded-control border border-line bg-field px-2 text-xs text-ink hover:border-line-strong",
          transition,
          focusRing,
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "h-2 w-2 rounded-chip",
            which === "l" ? "bg-info" : "bg-accent",
          )}
        />
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">{formatSurveyDate(date, true)}</span>
        <Icon name="chevron-down" size={12} className="text-muted" />
      </button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={ref}
        label={`${label} survey date`}
        side="bottom"
        align="start"
        items={[...dates].reverse().map((d) => ({
          id: d,
          label: formatSurveyDate(d),
          icon: d === date ? ("check" as const) : undefined,
          onSelect: () => onPick(d),
        }))}
      />
    </>
  );
}

/** M §5 Compare panel: the mode switch, the date chips and, in Blend, the slider. `C` is W1's. */
export function CompareBar() {
  const { surveys, mode, l, r, blend, setMode, setDates, setBlend } =
    useWorkspace(
      useShallow((s) => ({
        surveys: s.surveys,
        mode: s.mode,
        l: s.l,
        r: s.r,
        blend: s.blend,
        setMode: s.setMode,
        setDates: s.setDates,
        setBlend: s.setBlend,
      })),
    );
  const dates = useMemo(() => flownDates(surveys), [surveys]);
  const one = !canCompare(surveys);
  const comparing = mode !== "single";

  const pick = (which: "l" | "r") => (date: string) => {
    const next = pickDate({ l, r }, which, date, dates, comparing);
    if (next) setDates(next.l, next.r);
    else
      toast(
        "info",
        which === "l"
          ? "No later survey to compare with"
          : "No earlier survey to compare with",
      );
  };

  const seg = (
    <Segmented
      label="Compare mode"
      size="sm"
      value={mode}
      options={OPTIONS.map((o) => ({
        ...o,
        disabled: one && o.value !== "single",
      }))}
      onChange={setMode}
    />
  );

  return (
    <GlassPanel
      variant="float"
      radius="panel"
      data-testid="compare-bar"
      className="flex items-center gap-2 px-2 py-1.5"
    >
      {one ? (
        <Tooltip label={dates.length === 0 ? "No surveys yet" : "One survey so far"}>{seg}</Tooltip>
      ) : (
        seg
      )}
      {comparing && (
        <DateChip
          which="l"
          label="Left"
          date={l}
          dates={dates}
          onPick={pick("l")}
        />
      )}
      {dates.length > 0 && (
        <DateChip
          which="r"
          label={comparing ? "Right" : "Survey"}
          date={r}
          dates={dates}
          onPick={pick("r")}
        />
      )}
      {mode === "blend" && (
        <div className="flex items-center gap-2 text-2xs text-muted">
          <span className="tabular-nums">{formatSurveyDate(l, true)}</span>
          <Slider
            label="Blend"
            min={0}
            max={100}
            step={1}
            value={blend}
            onChange={setBlend}
            showValue={false}
            className="w-28"
          />
          <span className="tabular-nums">{formatSurveyDate(r, true)}</span>
        </div>
      )}
    </GlassPanel>
  );
}
