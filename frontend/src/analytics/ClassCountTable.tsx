import type { ClassCountRow } from "@/api/analytics";
import { countText } from "./format";

/** Class by count, each shown as total (verified), or verified only. */
export function ClassCountTable({
  rows,
  unit,
  verifiedOnly,
  testId,
}: {
  rows: ClassCountRow[];
  unit: string;
  verifiedOnly: boolean;
  testId?: string;
}) {
  return (
    <table data-testid={testId} className="w-full max-w-lg text-sm">
      <thead>
        <tr className="text-left text-muted">
          <th className="py-2 font-medium">Class</th>
          <th className="text-right font-medium">
            {verifiedOnly ? `Verified ${unit}` : `${unit[0].toUpperCase()}${unit.slice(1)}`}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.class_id} className="border-t border-line">
            <td className="py-2 text-ink">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: r.colour }}
                />
                {r.name}
              </span>
            </td>
            <td className="text-right tabular-nums text-ink">
              {countText(r.total, r.verified, verifiedOnly)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
