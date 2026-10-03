import { useMemo, type CSSProperties } from "react";
import { formatConfidentiality, useBrandLogoSrc, type Brand } from "@/api/brands";
import type { BlockOf } from "@/api/reports";
import { PRINT, mm, mmVar, textStyle } from "@/reports/printTheme";
import { CoverBlock } from "@/reports/preview/blocks/CoverBlock";
import { coverBrandOf } from "@/reports/preview/coverBrand";
import { PreviewEnvContext, type PreviewEnv } from "@/reports/preview/PreviewContext";

const SAMPLE_CLIENT = "Sample client";
const SAMPLE: BlockOf<"cover"> = {
  kind: "cover",
  title: "Facade inspection",
  subtitle: "Sample cover",
  rows: [
    ["Client", SAMPLE_CLIENT],
    ["Report date", "2026-10-03"],
  ],
  logo: null,
  locator: null,
};

/** The top of an A4 cover in the brand (spec 2026-10-02-asset-findings §9): the report preview's own
 * CoverBlock, and the footer line the PDF prints. */
export function BrandCoverPreview({ brand }: { brand: Brand }) {
  const logoSrc = useBrandLogoSrc()(brand, "on_dark");
  const env = useMemo<PreviewEnv>(
    () => ({
      resolveSnapshot: () => null,
      resolveAsset: () => null,
      scrollRoot: null,
      paper: "A4",
      brand: coverBrandOf(brand, logoSrc),
    }),
    [brand, logoSrc],
  );
  const footer = [
    brand.website,
    formatConfidentiality(brand.confidentiality, new Date().getFullYear(), SAMPLE_CLIENT),
  ]
    .filter((part) => part.trim())
    .join("  ·  ");
  const column = { "--mm": mmVar("A4"), width: mm(210), maxWidth: "100%" } as CSSProperties;
  return (
    <figure aria-label="Cover preview" className="m-0 flex flex-col gap-2">
      <div style={{ containerType: "inline-size" }}>
        <div style={column}>
          <PreviewEnvContext.Provider value={env}>
            <div
              data-testid="brand-cover-preview"
              className="relative overflow-hidden font-sans shadow-elev-1"
              style={{ background: PRINT.paper, color: PRINT.ink, height: mm(170), borderRadius: mm(1) }}
            >
              <CoverBlock block={SAMPLE} />
              <p
                data-brand-footer
                className="absolute"
                style={{
                  ...textStyle(PRINT.size.small, PRINT.muted),
                  left: mm(PRINT.margin),
                  right: mm(PRINT.margin),
                  bottom: mm(6),
                  margin: 0,
                }}
              >
                {footer}
              </p>
            </div>
          </PreviewEnvContext.Provider>
        </div>
      </div>
      <figcaption className="text-2xs text-muted">
        The preview uses fonts installed on this computer; the PDF embeds the brand fonts.
      </figcaption>
    </figure>
  );
}
