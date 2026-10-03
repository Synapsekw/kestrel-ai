import { useState } from "react";
import type { BlockOf } from "@/api/reports";
import { PRINT, mm, paperOf, textStyle } from "../../printTheme";
import { usePreviewEnv } from "../PreviewContext";
import { FigureBlock } from "./FigureBlock";
import { KvBlock } from "./KvBlock";

/**
 * The cover section's one block (spec §7.1, Ruling R-6): a full-bleed gradient band with the title,
 * subtitle and (when resolvable) the logo, in the report's brand when the preview has one
 * (spec 2026-10-02-asset-findings �9), then the rows and the site locator inside the page margins.
 * The sheet gives this block no padding of its own — it lays out the band and margins itself.
 */
export function CoverBlock({ block }: { block: BlockOf<"cover"> }) {
  const env = usePreviewEnv();
  const logoSrc = block.logo ? env.resolveAsset(block.logo.asset_id) : null;
  // The src that failed to load: its chip is hidden (no broken-image icon on the cover); a new src shows again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showLogo = logoSrc !== null && logoSrc !== failedSrc;
  // The brand logo has its own failed src: one image's failure must not un-hide the other's broken image.
  const [failedBrandSrc, setFailedBrandSrc] = useState<string | null>(null);
  const brand = env.brand ?? null;
  const brandLogo = brand?.logoSrc ?? null;
  const showBrandLogo = brandLogo !== null && brandLogo !== failedBrandSrc;
  const gradient = brand?.gradient ?? PRINT.cover;
  const titleFont = brand?.fontFamily ? `"${brand.fontFamily}", sans-serif` : undefined;
  const bandHeightMm = paperOf(env.paper).height_mm * PRINT.coverBand;
  return (
    <section data-block="cover">
      <div
        data-cover-band
        className="relative"
        style={{
          height: mm(bandHeightMm),
          background: `linear-gradient(135deg, ${gradient.join(", ")})`,
          padding: mm(PRINT.margin),
        }}
      >
        <p style={{ ...textStyle(PRINT.size.coverTitle, PRINT.paper), fontWeight: 600, margin: 0, fontFamily: titleFont }}>
          {block.title}
        </p>
        {block.subtitle ? (
          <p style={{ ...textStyle(PRINT.size.coverSubtitle, PRINT.paper), margin: `${mm(2)} 0 0`, fontFamily: titleFont }}>
            {block.subtitle}
          </p>
        ) : null}
        {showLogo ? (
          <div
            data-logo-chip
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
            <img
              src={logoSrc}
              alt="Logo"
              onError={() => setFailedSrc(logoSrc)}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          </div>
        ) : null}
        {showBrandLogo ? (
          <img
            data-brand-logo
            src={brandLogo}
            alt="Brand logo"
            onError={() => setFailedBrandSrc(brandLogo)}
            className="absolute"
            style={{
              left: mm(PRINT.margin),
              bottom: mm(PRINT.margin),
              height: mm(10),
              maxWidth: mm(60),
              objectFit: "contain",
            }}
          />
        ) : null}
      </div>
      <div style={{ padding: `${mm(4)} ${mm(PRINT.margin)} 0` }}>
        <KvBlock block={{ kind: "kv", rows: block.rows }} />
        {block.locator ? <FigureBlock block={block.locator} /> : null}
      </div>
    </section>
  );
}
