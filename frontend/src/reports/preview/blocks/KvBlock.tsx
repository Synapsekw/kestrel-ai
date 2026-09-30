import type { BlockOf } from "@/api/reports";
import { PRINT, mm, textStyle } from "../../printTheme";

export function KvBlock({ block }: { block: BlockOf<"kv"> }) {
  return (
    <table data-block="kv" style={{ width: "100%", borderCollapse: "collapse", margin: `0 0 ${mm(3)}` }}>
      <tbody>
        {block.rows.map(([label, value], i) => (
          <tr key={i} style={{ borderBottom: `${mm(0.2)} solid ${PRINT.rule}` }}>
            <th
              scope="row"
              style={{
                ...textStyle(PRINT.size.body, PRINT.muted),
                fontWeight: 500,
                textAlign: "left",
                width: "34%",
                padding: `${mm(1)} ${mm(2)} ${mm(1)} 0`,
                verticalAlign: "top",
              }}
            >
              {label}
            </th>
            <td style={{ ...textStyle(PRINT.size.body), padding: `${mm(1)} 0`, verticalAlign: "top" }}>
              {value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
