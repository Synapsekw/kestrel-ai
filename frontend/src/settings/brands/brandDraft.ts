import type { Brand, BrandColors, BrandPatch } from "@/api/brands";

export const COLOUR_KEYS: readonly (keyof BrandColors)[] = [
  "accent",
  "accent_dark",
  "navy",
  "ink",
  "pale",
  "line",
];

export const COLOUR_LABELS: Record<keyof BrandColors, string> = {
  accent: "Accent",
  accent_dark: "Accent dark",
  navy: "Navy",
  ink: "Ink",
  pale: "Pale",
  line: "Line",
};

const HEX = /^#[0-9a-f]{6}$/i;
const TEXT = ["website", "owner", "confidentiality", "pdf_author"] as const;

export interface BrandDraft {
  name: string;
  colors: BrandColors;
  font_text: string | null;
  font_numerals: string | null;
  website: string;
  owner: string;
  confidentiality: string;
  pdf_author: string;
}

export interface DraftErrors {
  name?: string;
  colors: Partial<Record<keyof BrandColors, string>>;
}

export function draftOf(brand: Brand): BrandDraft {
  return {
    name: brand.name,
    colors: { ...brand.colors },
    font_text: brand.font_text,
    font_numerals: brand.font_numerals,
    website: brand.website,
    owner: brand.owner,
    confidentiality: brand.confidentiality,
    pdf_author: brand.pdf_author,
  };
}

const cleanName = (name: string) => name.split(/\s+/).filter(Boolean).join(" ");

export function draftErrors(d: BrandDraft): DraftErrors {
  const errors: DraftErrors = { colors: {} };
  if (!cleanName(d.name)) errors.name = "A brand needs a name.";
  for (const key of COLOUR_KEYS) {
    if (!HEX.test(d.colors[key])) errors.colors[key] = "Use a colour like #1F4FD1.";
  }
  return errors;
}

export function hasErrors(e: DraftErrors): boolean {
  return Boolean(e.name) || Object.keys(e.colors).length > 0;
}

export function patchOf(brand: Brand, d: BrandDraft): BrandPatch {
  const patch: BrandPatch = {};
  const name = cleanName(d.name);
  if (name !== brand.name) patch.name = name;
  const upper = Object.fromEntries(COLOUR_KEYS.map((k) => [k, d.colors[k].toUpperCase()])) as BrandColors;
  if (COLOUR_KEYS.some((k) => upper[k] !== brand.colors[k].toUpperCase())) patch.colors = upper;
  if (d.font_text !== brand.font_text) patch.font_text = d.font_text;
  if (d.font_numerals !== brand.font_numerals) patch.font_numerals = d.font_numerals;
  for (const key of TEXT) {
    const value = d[key].trim();
    if (value !== brand[key]) patch[key] = value;
  }
  return patch;
}

export function previewOf(brand: Brand, d: BrandDraft): Brand {
  const colors = Object.fromEntries(
    COLOUR_KEYS.map((k) => [k, HEX.test(d.colors[k]) ? d.colors[k] : brand.colors[k]]),
  ) as BrandColors;
  return {
    ...brand,
    name: cleanName(d.name) || brand.name,
    colors,
    font_text: d.font_text,
    font_numerals: d.font_numerals,
    website: d.website,
    owner: d.owner,
    confidentiality: d.confidentiality,
    pdf_author: d.pdf_author,
  };
}

export function nextBrandName(names: string[]): string {
  const taken = new Set(names.map((n) => cleanName(n).toLowerCase()));
  if (!taken.has("new brand")) return "New brand";
  for (let i = 2; ; i += 1) {
    const candidate = `New brand ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
