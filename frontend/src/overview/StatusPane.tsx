import type { Activity } from "@/api/findings";
import { cx, GlassPanel } from "@/ui";
import { ActivityFeed } from "./ActivityFeed";
import type { SeverityRow } from "./kpis";
import { RunningJobs } from "./RunningJobs";
import { SeverityBars } from "./SeverityBars";

export const STATUS_ACTIVITY = 3;

/** Spec D7: severity bars, running jobs (only while running) and the last three activity lines, in one pane. */
export function StatusPane({
  projectId,
  rows,
  activity,
  activityFailed,
  showBars,
  className,
}: {
  projectId: string;
  rows: SeverityRow[];
  activity: Activity[];
  activityFailed: boolean;
  showBars: boolean;
  className?: string;
}) {
  return (
    <GlassPanel
      variant="pane"
      as="section"
      aria-label="Status"
      className={cx("flex min-h-0 flex-col gap-3 overflow-hidden px-4 py-3.5", className)}
    >
      {showBars && <SeverityBars rows={rows} bare />}
      <RunningJobs projectId={projectId} bare hideWhenIdle />
      <ActivityFeed
        projectId={projectId}
        items={activity.slice(0, STATUS_ACTIVITY)}
        failed={activityFailed}
        bare
      />
    </GlassPanel>
  );
}
