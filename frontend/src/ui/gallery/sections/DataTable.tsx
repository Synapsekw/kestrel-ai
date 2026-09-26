import { useState } from "react";
import { DataTable, type Column, type Sort } from "@/ui/DataTable";
import { SeverityPill } from "@/ui/Severity";
import { StatusDot, type DotStatus } from "@/ui/StatusDot";
import { TypeChip } from "@/ui/TypeChip";

export const title = "Data table";
export const order = 140;

interface Finding {
  id: string;
  number: number;
  type: "Crack" | "Spalling";
  severity: number | null;
  status: DotStatus;
}

const PAGE = 200;
const page = (from: number): Finding[] =>
  Array.from({ length: PAGE }, (_, i) => {
    const n = from + i;
    return {
      id: `f${n}`,
      number: n + 1,
      type: n % 3 ? "Crack" : "Spalling",
      severity: n % 5 === 0 ? null : (n % 4) + 1,
      status: (["open", "reviewed", "closed"] as const)[n % 3],
    };
  });

const COLUMNS: Column<Finding>[] = [
  {
    key: "number",
    header: "Finding",
    width: "96px",
    sortable: true,
    render: (f) => <span className="font-mono">{`F-${String(f.number).padStart(4, "0")}`}</span>,
  },
  {
    key: "type",
    header: "Type",
    sortable: true,
    render: (f) => (
      <TypeChip
        name={f.type}
        colour={f.type === "Crack" ? "#ff5a4f" : "#ff9c3a"}
        kind="defect"
        showKind={false}
      />
    ),
  },
  {
    key: "severity",
    header: "Severity",
    width: "140px",
    sortable: true,
    render: (f) => <SeverityPill level={f.severity} size="sm" />,
  },
  {
    key: "status",
    header: "Status",
    width: "120px",
    render: (f) => (
      <span className="inline-flex items-center gap-2 capitalize">
        <StatusDot status={f.status} />
        {f.status}
      </span>
    ),
  },
];

export default function DataTableSection() {
  const [rows, setRows] = useState<Finding[]>(() => page(0));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sort, setSort] = useState<Sort | null>({ key: "severity", dir: "desc" });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      <p className="text-2xs text-muted">
        {rows.length.toLocaleString()} of 10,000 loaded · {selected.size} selected · open: {open ?? "none"}
      </p>
      <DataTable
        label="Findings"
        className="h-[440px]"
        columns={COLUMNS}
        rows={rows}
        total={10_000}
        rowKey={(f) => f.id}
        selected={selected}
        onSelectionChange={setSelected}
        sort={sort}
        onSortChange={setSort}
        onOpen={(f) => setOpen(f.id)}
        activeKey={open}
        onEndReached={() => setRows((r) => (r.length >= 10_000 ? r : [...r, ...page(r.length)]))}
      />
    </div>
  );
}
