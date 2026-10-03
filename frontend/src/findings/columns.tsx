import type { ClassDef } from "@contract/client";
import type { Finding } from "@/api/findings";
import { Icon, SeverityPill, StatusDot, TypeChip, type Column } from "@/ui";
import { zoneKey } from "./assetLookups";
import { FindingThumb } from "./FindingThumb";
import { formatFindingNumber, formatHeight, relativeTime } from "./format";
import { findingLocation } from "./location";
import { STATUS_LABEL } from "./status";

export interface ColumnContext {
  projectId: string;
  types: ReadonlyMap<string, ClassDef>;
  labels: ReadonlyMap<string, string>;
  nowMs: number;
  /** Show the asset columns (an asset finding is in view, or the filters ask for asset findings). */
  asset: boolean;
  zoneLabels: ReadonlyMap<string, string>;
}

/** A finding whose type left the project still shows an outline, in the muted ink. */
const UNKNOWN_TYPE_COLOUR = "rgb(var(--muted))";

const muted = (text: string) => <span className="text-xs text-muted">{text}</span>;

/** Spec §9 Register: height, side, zone, component, sightings. Empty for other anchors. */
function assetColumns(ctx: ColumnContext): Column<Finding>[] {
  const onAsset = (f: Finding) => f.anchor.kind === "asset";
  return [
    {
      key: "height",
      header: "Height",
      width: "88px",
      align: "end",
      render: (f) =>
        !onAsset(f) ? null : f.height_m === null ? (
          muted("Unplaced")
        ) : (
          <span className="font-mono text-xs tabular-nums text-ink">{formatHeight(f.height_m)}</span>
        ),
    },
    { key: "side", header: "Side", width: "80px", render: (f) => (f.side ? muted(f.side) : null) },
    {
      key: "zone",
      header: "Zone",
      width: "110px",
      render: (f) =>
        f.zone && f.asset_model_id
          ? muted(ctx.zoneLabels.get(zoneKey(f.asset_model_id, f.zone)) ?? f.zone)
          : null,
    },
    {
      key: "component",
      header: "Component",
      width: "minmax(100px,0.6fr)",
      render: (f) =>
        f.component ? <span className="truncate text-xs text-muted">{f.component}</span> : null,
    },
    {
      key: "sightings",
      header: "Sightings",
      width: "84px",
      align: "end",
      render: (f) =>
        onAsset(f) ? (
          <span className="font-mono text-xs tabular-nums text-muted">{f.sighting_count}</span>
        ) : null,
    },
  ];
}

/** The Findings table (F §8.6): select (from DataTable), thumbnail, number, type, severity, location, status, updated. */
export function findingColumns(ctx: ColumnContext): Column<Finding>[] {
  const head: Column<Finding>[] = [
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
  ];
  const tail: Column<Finding>[] = [
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
  return [...head, ...(ctx.asset ? assetColumns(ctx) : []), ...tail];
}
