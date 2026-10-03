import { useCallback, useContext, useEffect, useState } from "react";
import type { ApiClient, components } from "@contract/client";
import { pushLog } from "@/app/diagnostics";
import { ApiContext, useApi } from "./client";
import { codeOf, isNotImplemented, messageOf, unwrap } from "./errors";

type S = components["schemas"];
export type Brand = S["Brand"];
export type BrandColors = S["BrandColors"];
export type BrandCreate = S["BrandCreate"];
export type BrandPatch = S["BrandPatch"];
export type BrandLogoSlot = S["BrandLogoSlot"];

/** The families D2 bundles (backend app/brands/fonts.py FAMILIES); anything else is 422 `unknown_font`. */
export const BRAND_FONTS = ["Nunito Sans", "Poppins", "Inter"] as const;
export const LOGO_SLOTS: readonly BrandLogoSlot[] = ["on_light", "on_dark", "flat"];

/** App level, not per project (spec 2026-10-02-asset-findings §8). At most 200 rows, no cursor. */
export async function fetchBrands(api: ApiClient): Promise<Brand[]> {
  const r = await unwrap(api.GET("/api/v1/brands"));
  return r.items;
}

export function createBrand(api: ApiClient, body: BrandCreate): Promise<Brand> {
  return unwrap(api.POST("/api/v1/brands", { body }));
}

export function patchBrand(api: ApiClient, brandId: string, body: BrandPatch): Promise<Brand> {
  return unwrap(api.PATCH("/api/v1/brands/{brandId}", { params: { path: { brandId } }, body }));
}

/** A built-in answers 409 `brand_builtin`; the editor never offers it. */
export async function deleteBrand(api: ApiClient, brandId: string): Promise<void> {
  await unwrap(api.DELETE("/api/v1/brands/{brandId}", { params: { path: { brandId } } }));
}

/** A local PNG, JPEG or WebP; the backend keeps a copy beside catalogue.db (D2). */
export function setBrandLogo(
  api: ApiClient,
  brandId: string,
  slot: BrandLogoSlot,
  path: string,
): Promise<Brand> {
  return unwrap(
    api.PUT("/api/v1/brands/{brandId}/logos/{slot}", { params: { path: { brandId, slot } }, body: { path } }),
  );
}

export function clearBrandLogo(api: ApiClient, brandId: string, slot: BrandLogoSlot): Promise<Brand> {
  return unwrap(api.DELETE("/api/v1/brands/{brandId}/logos/{slot}", { params: { path: { brandId, slot } } }));
}

export function logoIdOf(brand: Brand, slot: BrandLogoSlot): string | null {
  return brand[`logo_${slot}`] ?? null;
}

/** `?v=` is the logo id: the backend caches the answer as immutable, and a new logo is a new URL. */
export function brandLogoUrl(
  brandId: string,
  slot: BrandLogoSlot,
  logoId: string,
  backend?: { baseUrl: string; token: string },
): string {
  const path = `/api/v1/brands/${encodeURIComponent(brandId)}/logos/${slot}`;
  const q = new URLSearchParams({ v: logoId });
  if (!backend) return `${path}?${q}`;
  q.set("token", backend.token);
  return `${backend.baseUrl.replace(/\/$/, "")}${path}?${q}`;
}

/** Logo `<img src>` resolver; null outside an ApiProvider (the gallery) or for an empty slot. */
export function useBrandLogoSrc(): (brand: Brand, slot: BrandLogoSlot) => string | null {
  const info = useContext(ApiContext)?.info ?? null;
  return useCallback(
    (brand: Brand, slot: BrandLogoSlot) => {
      const id = logoIdOf(brand, slot);
      return info && id ? brandLogoUrl(brand.id, slot, id, info) : null;
    },
    [info],
  );
}

export function isBrandNameTaken(err: unknown): boolean {
  return codeOf(err) === "brand_name_taken";
}

/** The footer line as the PDF prints it (D2 `confidentiality_line`'s twin). */
export function formatConfidentiality(text: string, year: number, customer: string | null): string {
  const who = (customer ?? "").trim() || "the client";
  return text.split("{year}").join(String(year)).split("{customer}").join(who);
}

export interface BrandsList {
  brands: Brand[];
  loading: boolean;
  /** 501 while the brand operations are still stubs. */
  unavailable: boolean;
  error: string | null;
  reload: () => void;
  replace: (b: Brand) => void;
  add: (b: Brand) => void;
  remove: (brandId: string) => void;
}

interface BrandsState {
  key: string;
  brands: Brand[];
  unavailable: boolean;
  error: string | null;
}

export function useBrands(): BrandsList {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const key = String(attempt);
  const [state, setState] = useState<BrandsState>({ key: "", brands: [], unavailable: false, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchBrands(api)
      .then((brands) => {
        if (!cancelled) setState({ key, brands, unavailable: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load brands failed: ${messageOf(e, String(e))}`);
        const unavailable = isNotImplemented(e);
        setState({
          key,
          brands: [],
          unavailable,
          error: unavailable ? null : messageOf(e, "could not load the brands"),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [api, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const replace = useCallback(
    (b: Brand) => setState((s) => ({ ...s, brands: s.brands.map((x) => (x.id === b.id ? b : x)) })),
    [],
  );
  const add = useCallback((b: Brand) => setState((s) => ({ ...s, brands: [...s.brands, b] })), []);
  const remove = useCallback(
    (brandId: string) => setState((s) => ({ ...s, brands: s.brands.filter((x) => x.id !== brandId) })),
    [],
  );
  const loaded = state.key === key;
  return {
    brands: state.brands,
    loading: !loaded,
    unavailable: loaded && state.unavailable,
    error: loaded ? state.error : null,
    reload,
    replace,
    add,
    remove,
  };
}
