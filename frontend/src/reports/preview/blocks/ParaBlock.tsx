import type { CSSProperties } from "react";
import type { BlockOf } from "@/api/reports";
import { PRINT, mm, textStyle } from "../../printTheme";

export function ParaBlock({ block }: { block: BlockOf<"para"> }) {
  const small = block.style === "small";
  const note: CSSProperties =
    block.style === "note" ? { borderLeft: `${mm(0.8)} solid ${PRINT.accent}`, paddingLeft: mm(3) } : {};
  return (
    <div
      data-block="para"
      style={{
        ...textStyle(small ? PRINT.size.small : PRINT.size.body, small ? PRINT.muted : PRINT.ink),
        margin: `0 0 ${mm(2.5)}`,
        ...note,
      }}
    >
      {block.text.split(/\n{2,}/).map((p, i) => (
        <p key={i} style={{ margin: i ? `${mm(2)} 0 0` : 0, whiteSpace: "pre-line" }}>
          {p}
        </p>
      ))}
    </div>
  );
}
