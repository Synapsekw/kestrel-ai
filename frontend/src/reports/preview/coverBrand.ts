import type { Brand } from "@/api/brands";
import { PRINT_THEME, withBrand } from "../printTheme";
import type { CoverBrand } from "./PreviewContext";

/** The cover look of a brand, through the same overlay rules the PDF uses (D2's withBrand). */
export function coverBrandOf(brand: Brand, logoSrc: string | null): CoverBrand {
  const theme = withBrand(PRINT_THEME, brand);
  return {
    gradient: theme.cover.gradient,
    fontFamily: brand.font_text,
    logoSrc,
    headFill: theme.colours.head_fill,
  };
}
