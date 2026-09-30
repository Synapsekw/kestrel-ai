import type { BlockOf } from "@/api/reports";
import { PRINT, mm, paperOf, textStyle } from "../../printTheme";
import { usePreviewEnv } from "../PreviewContext";
import { FigureBlock } from "./FigureBlock";
import { KvBlock } from "./KvBlock";

/**
 * The cover section's one block (spec §7.1, Ruling R-6): a full-bleed gradient band with the title,
 * subtitle and (when resolvable) the logo, then the rows and the site locator inside the page margins.
 * The sheet gives this block no padding of its own — it lays out the band and margins itself.
 */
export function CoverBlock({ block }: { block: BlockOf<"cover"> }) {
  const env = usePreviewEnv();
  const logoSrc = block.logo ? env.resolveAsset(block.logo.asset_id) : null;
  const bandHeightMm = paperOf(env.paper).height_mm * PRINT.coverBand;
  return (
    <section data-block="cover">
      <div
        data-cover-band
        className="relative"
        style={{
          height: mm(bandHeightMm),
          background: `linear-gradient(135deg, ${PRINT.cover.join(", ")})`,
          padding: mm(PRINT.margin),
        }}
      >
        <p style={{ ...textStyle(PRINT.size.coverTitle, PRINT.paper), fontWeight: 600, margin: 0 }}>
          {block.title}
        </p>
        {block.subtitle ? (
          <p style={{ ...textStyle(PRINT.size.coverSubtitle, PRINT.paper), margin: `${mm(2)} 0 0` }}>
            {block.subtitle}
          </p>
        ) : null}
        {logoSrc ? (
          <div
            className="absolute overflow-hidden"
            style={{
              top: mm(PRINT.margin),
              right: mm(PRINT.margin),
              width: mm(PRINT.logoChip[0]),
              height: mm(PRINT.logoChip[1]),
              borderRadius: mm(PRINT.radius),
              background: PRINT.paper,
            }}
          >
            <img src={logoSrc} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
        ) : null}
      </div>
      <div style={{ padding: `${mm(4)} ${mm(PRINT.margin)} 0` }}>
        <KvBlock block={{ kind: "kv", rows: block.rows }} />
        {block.locator ? <FigureBlock block={block.locator} /> : null}
      </div>
    </section>
  );
}
