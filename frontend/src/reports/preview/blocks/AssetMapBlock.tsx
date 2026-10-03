import type { BlockOf } from "@/api/reports";
import { PRINT, mm, textStyle } from "../../printTheme";
import { AssetDrawingSvg } from "./AssetDrawingSvg";

/** The asset findings map (spec 2026-10-02-asset-findings §10): title, vector map, caption. */
export function AssetMapBlock({ block }: { block: BlockOf<"asset_map"> }) {
  const subject = block.title || "the asset";
  return (
    <figure data-block="asset_map" style={{ margin: `0 0 ${mm(4)}` }}>
      {block.title ? (
        <p style={{ ...textStyle(PRINT.size.h3), fontWeight: 600, margin: `0 0 ${mm(1.5)}` }}>
          {block.title}
        </p>
      ) : null}
      <AssetDrawingSvg
        drawing={block.drawing}
        label={`Findings map of ${subject}`}
        widthMm={block.width_mm}
      />
      {block.caption ? (
        <figcaption style={{ ...textStyle(PRINT.size.small, PRINT.muted), marginTop: mm(1) }}>
          {block.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
