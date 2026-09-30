import type { CSSProperties } from "react";
import type { BlockOf } from "@/api/reports";
import { PRINT, mm, textStyle } from "../../printTheme";
import { Dot } from "./marks";

const alignOf = (a: unknown): CSSProperties["textAlign"] =>
  a === "right" ? "right" : a === "center" ? "center" : "left";

function isDotCell(cell: unknown): cell is { text: string; dot: string } {
  return typeof cell === "object" && cell !== null && "text" in cell && "dot" in cell;
}

function cellContent(cell: unknown) {
  if (cell === null || cell === undefined) return "";
  if (isDotCell(cell)) {
    return (
      <span className="inline-flex items-center" style={{ gap: mm(1.2) }}>
        <Dot colour={cell.dot} sizeMm={1.8} />
        {cell.text}
      </span>
    );
  }
  return String(cell);
}

/** Ruling 13: `repeat_header` only matters when a table crosses a printed page. */
export function TableBlock({ block }: { block: BlockOf<"table"> }) {
  const pad = `${mm(1.2)} ${mm(1.5)}`;
  return (
    <table
      data-block="table"
      style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", margin: `0 0 ${mm(4)}` }}
    >
      <colgroup>
        {block.columns.map((c) => (
          <col key={c.key} style={c.width_mm ? { width: mm(c.width_mm) } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr style={{ background: PRINT.head }}>
          {block.columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              style={{
                ...textStyle(PRINT.size.small),
                fontWeight: 600,
                textAlign: alignOf(c.align),
                padding: pad,
              }}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {block.rows.length === 0 ? (
          <tr>
            <td
              colSpan={Math.max(block.columns.length, 1)}
              style={{ ...textStyle(PRINT.size.body, PRINT.muted), padding: pad }}
            >
              No rows
            </td>
          </tr>
        ) : (
          block.rows.map((row, r) => (
            <tr key={r} style={{ borderBottom: `${mm(0.2)} solid ${PRINT.rule}` }}>
              {block.columns.map((c, i) => (
                <td
                  key={c.key}
                  className={c.style === "mono" ? "font-mono tabular-nums" : "tabular-nums"}
                  style={{
                    ...textStyle(PRINT.size.body),
                    textAlign: alignOf(c.align),
                    padding: pad,
                    overflowWrap: "anywhere",
                  }}
                >
                  {cellContent(row[i])}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
