import type { BlockOf } from "@/api/reports";
import { PRINT, mm, pt } from "../../printTheme";

const SIZE = [PRINT.size.h1, PRINT.size.h2, PRINT.size.h3] as const;
const TAG = ["h4", "h5", "h6"] as const;

/** Ruling 12: block level n renders as h(n+3), capped at h6. */
export function HeadingBlock({ block }: { block: BlockOf<"heading"> }) {
  const i = Math.min(Math.max(Math.round(block.level), 1), 3) - 1;
  const Tag = TAG[i];
  return (
    <Tag
      data-block="heading"
      className="font-sans font-semibold"
      style={{
        fontSize: pt(SIZE[i]),
        lineHeight: 1.25,
        color: PRINT.ink,
        margin: `${mm(i === 0 ? 2 : 4)} 0 ${mm(2)}`,
      }}
    >
      {block.text}
    </Tag>
  );
}
