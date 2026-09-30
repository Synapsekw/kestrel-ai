import type { BlockOf } from "@/api/reports";
import { PRINT, mm, textStyle } from "../../printTheme";
import { Dot } from "./marks";

const TONE = PRINT.tone;
const toneOf = (t: unknown): keyof typeof TONE =>
  t === "good" || t === "bad" || t === "warn" ? t : "neutral";

export function KpisBlock({ block }: { block: BlockOf<"kpis"> }) {
  const cols = Math.min(Math.max(block.items.length, 1), 5);
  return (
    <div
      data-block="kpis"
      className="grid"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: mm(3), margin: `0 0 ${mm(4)}` }}
    >
      {block.items.map((item, i) => (
        <div
          key={i}
          style={{
            border: `${mm(0.25)} solid ${PRINT.rule}`,
            borderRadius: mm(PRINT.radius),
            padding: mm(3),
          }}
        >
          <p style={{ ...textStyle(PRINT.size.small, PRINT.muted), margin: 0 }}>{item.label}</p>
          <p
            className="tabular-nums"
            style={{ ...textStyle(PRINT.size.kpi), fontWeight: 600, margin: `${mm(1)} 0 0` }}
          >
            {String(item.value)}
          </p>
          {item.delta ? (
            <p
              className="flex items-center tabular-nums"
              style={{ ...textStyle(PRINT.size.small), gap: mm(1), margin: `${mm(1)} 0 0` }}
            >
              <Dot colour={item.colour ?? TONE[toneOf(item.tone)]} sizeMm={1.8} />
              {item.delta}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
