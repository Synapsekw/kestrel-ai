import type { MeasurementItem } from "@/api/measurements";
import { relativeTime } from "@/findings/format";
import { Icon, Pill, type Column } from "@/ui";
import { formatHeadline, kindIcon, kindText, statusView } from "./model";

/** The Measurements table (R8): name, kind, headline, status, updated. Not sortable (R-W6-7). */
export function measurementColumns(nowMs: number): Column<MeasurementItem>[] {
  return [
    {
      key: "name",
      header: "Name",
      width: "minmax(0,2fr)",
      render: (m) => (
        <span className="flex min-w-0 items-center gap-2">
          <Icon name={kindIcon(m.kind)} size={14} className="shrink-0 text-muted" />
          <span className="truncate text-ink">{m.name || "Untitled"}</span>
        </span>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      width: "minmax(0,1fr)",
      render: (m) => <span className="text-muted">{kindText(m)}</span>,
    },
    {
      key: "headline",
      header: "Value",
      width: "150px",
      align: "end",
      render: (m) => <span className="font-mono text-xs text-ink">{formatHeadline(m.headline, m.unit)}</span>,
    },
    {
      key: "status",
      header: "Status",
      width: "130px",
      render: (m) => {
        const s = statusView(m.status);
        return (
          <Pill size="sm" tone={s.tone} live={s.live}>
            {s.label}
          </Pill>
        );
      },
    },
    {
      key: "updated",
      header: "Updated",
      width: "110px",
      render: (m) => <span className="text-xs text-muted">{relativeTime(m.updated_at, nowMs)}</span>,
    },
  ];
}
