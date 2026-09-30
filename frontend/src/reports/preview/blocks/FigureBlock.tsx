import type { BlockOf } from "@/api/reports";
import { PRINT, mm, textStyle } from "../../printTheme";
import { SnapshotImage } from "../SnapshotImage";

export function FigureBlock({ block, alt }: { block: BlockOf<"figure">; alt?: string }) {
  const name = alt ?? (block.caption || "Figure");
  return (
    <figure
      data-block="figure"
      style={{ margin: `0 0 ${mm(3)}`, width: mm(block.width_mm), maxWidth: "100%" }}
    >
      <SnapshotImage
        key={block.snapshot.key}
        snapshot={block.snapshot}
        widthMm={block.width_mm}
        heightMm={block.height_mm}
        alt={name}
      />
      {block.caption ? (
        <figcaption style={{ ...textStyle(PRINT.size.small, PRINT.muted), marginTop: mm(1) }}>
          {block.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
