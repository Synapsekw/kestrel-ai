import type { ClassDef } from "@contract/client";
import type { Finding } from "@/api/findings";
import { Icon, SeverityPill, StatusDot, TypeChip, type Column } from "@/ui";
import { FindingThumb } from "./FindingThumb";
import { formatFindingNumber, relativeTime } from "./format";
import { findingLocation } from "./location";
import { STATUS_LABEL } from "./status";

export interface ColumnContext {
  projectId: string;
  types: ReadonlyMap<string, ClassDef>;
  labels: ReadonlyMap<string, string>;
  nowMs: number;
}

/** A finding whose type left the project still shows an outline, in the muted ink. */
const UNKNOWN_TYPE_COLOUR = "rgb(var(--muted))";

/** The Findings table (F §8.6): select (from DataTable), thumbnail, number, type, severity, location, status, updated. */
export function findingColumns(ctx: ColumnContext): Column<Finding>[] {
  return [
    {
      key: "thumb",
      header: <span className="sr-only">Preview</span>,
      width: "60px",
      render: (f) => (
        <FindingThumb
          projectId={ctx.projectId}
          finding={f}
          colour={ctx.types.get(f.type_id)?.colour ?? UNKNOWN_TYPE_COLOUR}
        />
      ),
    },
    {
      key: "number",
      header: "ID",
      width: "84px",
      render: (f) => (
        <span className="font-mono text-xs tabular-nums text-ink">{formatFindingNumber(f.number)}</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      width: "200px",
      render: (f) => {
        const t = ctx.types.get(f.type_id);
        return t ? (
          <TypeChip name={t.name} colour={t.colour} kind={t.kind} />
        ) : (
          <span className="text-sm text-muted">Unknown type</span>
        );
      },
    },
    {
      key: "severity",
      header: "Severity",
      width: "130px",
      render: (f) => <SeverityPill level={f.severity} />,
    },
    {
      key: "location",
      header: "Location",
      width: "minmax(180px,1fr)",
      render: (f) => {
        const loc = findingLocation(f, ctx.labels);
        return (
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <Icon name={loc.icon} size={14} className="shrink-0 text-muted" />
            <span className="truncate">{loc.primary}</span>
            {loc.secondary && <span className="truncate font-mono text-2xs text-muted">{loc.secondary}</span>}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      width: "120px",
      render: (f) => (
        <span className="inline-flex items-center gap-2 text-xs text-muted">
          <StatusDot status={f.status} />
          {STATUS_LABEL[f.status]}
        </span>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      width: "110px",
      render: (f) => (
        <span className="text-xs tabular-nums text-muted">{relativeTime(f.updated_at, ctx.nowMs)}</span>
      ),
    },
  ];
}
