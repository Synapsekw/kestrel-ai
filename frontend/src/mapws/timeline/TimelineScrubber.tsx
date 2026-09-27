import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApi } from "@/api/client";
import { updateMapDate } from "@/api/sources";
import { SurveyDateCell } from "@/sources/SurveyDateCell";
import { GlassPanel, IconButton, Tooltip, cx, focusRing, transition } from "@/ui";
import { useWorkspace } from "../context";
import { bumpWorkspaceData } from "../data/useRasterLayers";
import type { PanelProps } from "../panels/panelRegistry";
import { canCompare } from "../state/surveys";
import { buildTicks, clickTick, formatSurveyDate, rangeText, summaryText, type Tick } from "./timelineModel";

const pct = (x: number) => `${(x * 100).toFixed(3)}%`;

/** M §5 Timeline: play, the summary, the range, the ticks and the L/R markers. W1 runs Play and the keys. */
export function TimelineScrubber({ projectId }: PanelProps) {
  const api = useApi();
  const { surveys, mode, l, r, playing, setDates, togglePlay } = useWorkspace(
    useShallow((s) => ({
      surveys: s.surveys,
      mode: s.mode,
      l: s.l,
      r: s.r,
      playing: s.playing,
      setDates: s.setDates,
      togglePlay: s.togglePlay,
    })),
  );
  const ticks = useMemo(() => buildTicks(surveys), [surveys]);
  const comparing = mode !== "single";
  const pair = { l, r };
  const posOf = (d: string | null) => ticks.find((t) => t.date === d)?.pos ?? null;
  const lPos = comparing ? posOf(l) : null;
  const rPos = posOf(r);
  const undated = ticks.filter(
    (t) => t.importDate && t.mapIds.length > 0 && (t.date === r || (comparing && t.date === l)),
  );
  const onTick = (t: Tick) => {
    const next = clickTick(pair, t, ticks, comparing);
    if (next) setDates(next.l, next.r);
  };

  return (
    <GlassPanel variant="float" radius="panel" className="flex w-[540px] flex-col gap-2 px-3 py-2.5">
      {ticks.length === 0 ? (
        <p className="px-1 py-1 text-xs text-muted">No surveys yet</p>
      ) : (
        <>
          <div className="flex items-center gap-2.5">
            <IconButton
              icon="play"
              size="sm"
              variant={playing ? "primary" : "secondary"}
              label={playing ? "Pause the timeline" : "Play the timeline"}
              aria-pressed={playing}
              aria-keyshortcuts="P"
              onClick={togglePlay}
              disabled={!canCompare(surveys)}
              className="rounded-chip"
            />
            <span className="text-xs font-medium text-ink">{summaryText(ticks)}</span>
            <span className="ml-auto font-mono text-2xs tabular-nums text-muted">
              {rangeText(pair, comparing)}
            </span>
          </div>
          <div className="relative mx-2 h-7" data-testid="timeline-track">
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-chip bg-surface-2" />
            {lPos !== null && rPos !== null && (
              <div
                className="absolute top-1/2 h-1 -translate-y-1/2 rounded-chip bg-grad-primary"
                style={{ left: pct(lPos), width: pct(rPos - lPos) }}
              />
            )}
            {ticks.map((t) =>
              t.planned ? (
                <div
                  key={t.date}
                  data-planned
                  className="absolute inset-y-1 -translate-x-1/2"
                  style={{ left: pct(t.pos) }}
                >
                  <Tooltip label={`Planned · ${formatSurveyDate(t.date)}`}>
                    <span className="block h-5 border-l border-dashed border-muted" />
                  </Tooltip>
                </div>
              ) : (
                <button
                  key={t.date}
                  type="button"
                  aria-label={`Survey ${formatSurveyDate(t.date)}${t.importDate ? " (date not set)" : ""}`}
                  aria-pressed={t.date === r || (comparing && t.date === l)}
                  onClick={() => onTick(t)}
                  className={cx(
                    "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-chip border-2",
                    t.importDate ? "border-muted bg-bg" : "border-ink bg-ink",
                    transition,
                    focusRing,
                  )}
                  style={{ left: pct(t.pos) }}
                />
              ),
            )}
            {lPos !== null && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -top-2 -translate-x-1/2 rounded-chip bg-info px-1.5 font-mono text-2xs text-bg"
                style={{ left: pct(lPos) }}
              >
                L
              </span>
            )}
            {rPos !== null && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -top-2 -translate-x-1/2 rounded-chip bg-accent px-1.5 font-mono text-2xs text-bg"
                style={{ left: pct(rPos) }}
              >
                R
              </span>
            )}
          </div>
          {undated.map((t) => (
            <div key={t.date} className="flex items-center gap-2 text-2xs text-muted">
              <span>{`Imported ${formatSurveyDate(t.date)}:`}</span>
              <SurveyDateCell
                label={`the survey imported ${formatSurveyDate(t.date)}`}
                value={null}
                onSave={async (d) => {
                  await Promise.all(t.mapIds.map((id) => updateMapDate(api, projectId, id, d)));
                  bumpWorkspaceData();
                }}
              />
            </div>
          ))}
        </>
      )}
    </GlassPanel>
  );
}
