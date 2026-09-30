import type { BlockOf } from "@/api/reports";
import { PRINT, mm, textStyle } from "../../printTheme";
import { FigureBlock } from "./FigureBlock";
import { KvBlock } from "./KvBlock";
import { Dot } from "./marks";

/** Index "Block kinds": the preview renders `volume` as a kv table plus its figure (spec §16 for stale). */
export function VolumeBlock({ block }: { block: BlockOf<"volume"> }) {
  const id = `volume-${block.measurement_id}`;
  return (
    <section data-block="volume" aria-labelledby={id} style={{ margin: `0 0 ${mm(5)}` }}>
      <p id={id} style={{ ...textStyle(PRINT.size.h3), fontWeight: 600, margin: `0 0 ${mm(2)}` }}>
        {block.title}
      </p>
      {block.stale ? (
        <p
          className="flex items-center"
          style={{ ...textStyle(PRINT.size.body), gap: mm(1.5), margin: `0 0 ${mm(2)}` }}
        >
          <Dot colour={PRINT.danger} />
          Stale, recalculate
        </p>
      ) : (
        <KvBlock block={{ kind: "kv", rows: block.rows }} />
      )}
      {block.figure ? <FigureBlock block={block.figure} /> : null}
    </section>
  );
}
