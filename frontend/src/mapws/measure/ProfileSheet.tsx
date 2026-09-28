import { createPortal } from "react-dom";
import { GlassPanel, IconButton, cx } from "@/ui";
import { ProfileChart, type ChartSeries } from "@/mapws/inspect/ProfileChart";
import { SHEET_BOX } from "@/mapws/inspect/profileScales";

export interface ProfileSheetProps {
  title: string;
  stations: readonly number[];
  series: readonly ChartSeries[];
  cursor: number | null;
  onCursor: (index: number | null) => void;
  onClose: () => void;
}

/**
 * Spec §9.2 "Expand": a bottom sheet the width of the stage, above the timeline. It renders into
 * W1's workspace root (`data-testid="map-workspace"`, positioned), or fixed to the window without it.
 * The one W3 surface with glass of its own (F7): it floats over the imagery, outside the inspector.
 */
export function ProfileSheet({ title, stations, series, cursor, onCursor, onClose }: ProfileSheetProps) {
  const stage = document.querySelector<HTMLElement>('[data-testid="map-workspace"]');
  return createPortal(
    <GlassPanel
      variant="float"
      role="dialog"
      aria-label={`${title}, expanded profile`}
      className={cx(
        "z-20 flex flex-col gap-2 p-3 animate-rise reduce-motion:animate-none",
        stage ? "absolute inset-x-4 bottom-[88px]" : "fixed inset-x-4 bottom-4",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-glass-ink">{title}</h2>
        <IconButton icon="x" label="Close the expanded profile" size="sm" onClick={onClose} />
      </div>
      <ProfileChart stations={stations} series={series} cursor={cursor} onCursor={onCursor} box={SHEET_BOX} />
    </GlassPanel>,
    stage ?? document.body,
  );
}
