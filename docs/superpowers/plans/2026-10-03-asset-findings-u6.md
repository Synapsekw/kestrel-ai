# Asset findings U6: brand editor and the report brand picker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator manages report brands in App settings. They can:
- list brands, create one and delete one (never a built-in);
- edit a brand's name, six colours, two fonts, three logos and four text fields;
- watch a live cover preview drawn by the same `CoverBlock` the report preview uses.

In the report builder they pick a brand, which writes `ReportConfig.brand_id`, and the builder's cover preview takes that brand's look.

**Architecture:**
- **`frontend/src/api/brands.ts`** holds the brand API: the types, the request functions (`fetchBrands`, `createBrand`, `patchBrand`, `deleteBrand`, `setBrandLogo`, `clearBrandLogo`), the `useBrands()` hook (keyed state, the `useProviders` pattern), the logo URL builder and hook, and two small helpers (`isBrandNameTaken`, `formatConfidentiality`).
- **The cover takes a brand through the preview context.**
  - `PreviewEnv` gains an optional `brand: CoverBrand | null` (gradient, title font, logo src).
  - `CoverBlock` draws the band in the brand gradient and the brand's `on_dark` logo.
  - `coverBrandOf(brand, logoSrc)` (`frontend/src/reports/preview/coverBrand.ts`) builds a `CoverBrand` through D2's `withBrand`, so the preview and the PDF read the same overlay rules.
- **The editor** (`frontend/src/settings/brands/`):
  - `brandDraft.ts`: a pure draft model (validation, the minimal patch, the preview brand);
  - `BrandLogoField.tsx`: one logo slot; the Tauri dialog, or a path field in the browser;
  - `BrandCoverPreview.tsx`: a cut-down A4 cover sheet with a sample block and the footer line;
  - `BrandEditor.tsx`: the form, save and delete;
  - `BrandsSection.tsx`: the list and the editor, mounted in `AppSettingsScreen` (brands are app level, like provider keys).
- **The builder.** `ReportBuilder` calls `useBrands()` once. It passes the list to `ReportSettings`, which adds the Brand select, and passes the resolved `CoverBrand` to `ReportPreview`.
- **Data colours.** Brand colours are data. They reach CSS only through inline `style` values (the gradient, `--c` on `ColourSwatch`), never through class names (`check-tokens`).

**Tech Stack:** React 18, TypeScript, Vite, Vitest and Testing Library, Playwright on the Prism mock; `frontend/src/ui` primitives; `@tauri-apps/plugin-dialog` (already a dependency).

**Spec sections covered:**
- §9 "Brand editor (Settings, Reports section): name, colours, fonts, three logos and the text fields, with a live cover preview";
- §9 "Everything uses `frontend/src/ui` primitives and passes `check-tokens`";
- §5.8 `ReportConfig.brand_id` from the UI;
- §12 e2e "brand editor preview".

**Index and Global Constraints:** `docs/superpowers/plans/2026-10-03-asset-findings.md`

**Needs:** D2 merged. D2 supplies:
- the real `/api/v1/brands` routes, the logo operations `setBrandLogo`, `clearBrandLogo` and `getBrandLogo`, and the schemas `Brand`, `BrandColors`, `BrandCreate`, `BrandPatch` and `BrandLogoSlot` in `contract/client/schema.d.ts`;
- `withBrand`, `BrandOverlayInput` and `PRINT_THEME.brand` in `frontend/src/reports/printTheme.ts`.

C0 adds `ReportConfig.brand_id` to the contract, and `reportConfig()` in `frontend/src/test/reportBuilderFixtures.ts` carries `brand_id: null`. No phase 0 dependency (no engine code).

**Worktree:** `scripts\start-task.ps1 -Name af-u6`

**Budget:** No background job. Every brand write is one request on one row. A logo import is a single synchronous request, bounded by D2: at most 20 MB, scaled to 1,200 px. The list is one request of at most 200 rows. The preview draws one cover block and fetches at most one logo image. Nothing reads an image set.

**Execution DAG (inside the unit):**
- Independent: Task 1 (api module), Task 2 (cover brand in the preview), Task 3 (draft model).
- Task 4 (logo field) needs Task 1.
- Task 5 (editor, section, App settings) needs Tasks 1 to 4.
- Task 6 (builder picker and preview) needs Tasks 1 and 2.
- Task 7 (e2e) needs Task 5.
- Task 8 (gate) needs all.
- Critical path: Task 1, Task 4, Task 5, Task 7, Task 8. Tasks 2, 3 and 6 run beside it.

UI copy rules for every task: sentence case, no em or en dashes, the words below verbatim.

---

### Task 1: `api/brands.ts`: requests, `useBrands`, logo URLs

**Files:**
- Create: `frontend/src/api/brands.ts`
- Create: `frontend/src/test/brandFixtures.ts`
- Test: `frontend/src/api/brands.test.ts`, `frontend/src/api/useBrands.test.tsx`

**Interfaces:**
- Consumes (contract, via D2): `GET /api/v1/brands` → `BrandList`; `POST /api/v1/brands` `BrandCreate` → `Brand`; `PATCH /api/v1/brands/{brandId}` `BrandPatch` → `Brand`; `DELETE /api/v1/brands/{brandId}` → 204; `PUT /api/v1/brands/{brandId}/logos/{slot}` `{path}` → `Brand`; `DELETE /api/v1/brands/{brandId}/logos/{slot}` → `Brand`; `GET /api/v1/brands/{brandId}/logos/{slot}` → PNG.
- Produces (module `@/api/brands`):
  - types `Brand`, `BrandColors`, `BrandCreate`, `BrandPatch`, `BrandLogoSlot`; constants `BRAND_FONTS = ["Nunito Sans", "Poppins", "Inter"]`, `LOGO_SLOTS = ["on_light", "on_dark", "flat"]`
  - `fetchBrands(api: ApiClient): Promise<Brand[]>`
  - `createBrand(api: ApiClient, body: BrandCreate): Promise<Brand>`
  - `patchBrand(api: ApiClient, brandId: string, body: BrandPatch): Promise<Brand>`
  - `deleteBrand(api: ApiClient, brandId: string): Promise<void>`
  - `setBrandLogo(api: ApiClient, brandId: string, slot: BrandLogoSlot, path: string): Promise<Brand>`
  - `clearBrandLogo(api: ApiClient, brandId: string, slot: BrandLogoSlot): Promise<Brand>`
  - `logoIdOf(brand: Brand, slot: BrandLogoSlot): string | null`
  - `brandLogoUrl(brandId: string, slot: BrandLogoSlot, logoId: string, backend?: {baseUrl: string; token: string}): string`
  - `useBrandLogoSrc(): (brand: Brand, slot: BrandLogoSlot) => string | null`
  - `isBrandNameTaken(err: unknown): boolean`
  - `formatConfidentiality(text: string, year: number, customer: string | null): string`
  - `useBrands(): BrandsList` with `{brands, loading, unavailable, error, reload, replace(b), add(b), remove(id)}`

- [ ] **Step 1: Write the fixtures**

Create `frontend/src/test/brandFixtures.ts`:

```ts
import type { Brand } from "@/api/brands";

const T0 = "2026-10-03T00:00:00Z";

export const EAND_ID = "builtin-eand";
export const WHITE_ID = "builtin-white-label";
export const PARTNER_ID = "b0000000-9999-4000-8000-000000000001";

export const eandBrand: Brand = {
  id: EAND_ID,
  name: "e&",
  colors: {
    accent: "#BC0000",
    accent_dark: "#9E0000",
    navy: "#141D2D",
    ink: "#1A1A1A",
    pale: "#FFE5E5",
    line: "#E7E4DE",
  },
  font_text: "Nunito Sans",
  font_numerals: "Poppins",
  logo_on_light: null,
  logo_on_dark: null,
  logo_flat: null,
  website: "www.eand.com",
  owner: "e&",
  confidentiality: "© {year} e&. All rights reserved.",
  pdf_author: "e& Drones, Robotics & AI",
  builtin: true,
  created_at: T0,
  updated_at: T0,
};

export const whiteLabelBrand: Brand = {
  id: WHITE_ID,
  name: "White label",
  colors: {
    accent: "#1F4FD1",
    accent_dark: "#173DA6",
    navy: "#131A26",
    ink: "#141821",
    pale: "#E8EEFF",
    line: "#E3E6EC",
  },
  font_text: "Inter",
  font_numerals: "Inter",
  logo_on_light: null,
  logo_on_dark: null,
  logo_flat: null,
  website: "",
  owner: "",
  confidentiality: "Confidential. Prepared for {customer}. Do not distribute without written consent.",
  pdf_author: "",
  builtin: true,
  created_at: T0,
  updated_at: T0,
};

export const partnerBrand: Brand = {
  ...whiteLabelBrand,
  id: PARTNER_ID,
  name: "Orbit Aerials",
  font_text: null,
  font_numerals: null,
  logo_on_dark: "logo-0123456789abcdef",
  website: "orbit.example",
  confidentiality: "",
  builtin: false,
};

export const exampleBrands: Brand[] = [eandBrand, whiteLabelBrand, partnerBrand];
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/api/brands.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { errorBody, fakeClient } from "@/test/fixtures";
import { EAND_ID, PARTNER_ID, exampleBrands, partnerBrand } from "@/test/brandFixtures";
import {
  brandLogoUrl,
  clearBrandLogo,
  createBrand,
  deleteBrand,
  fetchBrands,
  formatConfidentiality,
  isBrandNameTaken,
  logoIdOf,
  patchBrand,
  setBrandLogo,
} from "./brands";

describe("brand requests", () => {
  it("lists brands at the app level", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/api\/v1\/brands$/, body: { items: exampleBrands } },
    ]);
    expect((await fetchBrands(api)).map((b) => b.name)).toEqual(["e&", "White label", "Orbit Aerials"]);
    expect(requests[0].url).toBe("/api/v1/brands");
  });

  it("creates, patches and deletes", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/brands$/, status: 201, body: partnerBrand },
      { method: "PATCH", path: /\/brands\/[^/]+$/, body: { ...partnerBrand, website: "a.example" } },
      { method: "DELETE", path: /\/brands\/[^/]+$/, status: 204, body: null },
    ]);
    await createBrand(api, { name: "Orbit Aerials" });
    const saved = await patchBrand(api, PARTNER_ID, { website: "a.example" });
    await deleteBrand(api, PARTNER_ID);
    expect(saved.website).toBe("a.example");
    expect(requests.map((r) => [r.method, r.url, r.body])).toEqual([
      ["POST", "/api/v1/brands", { name: "Orbit Aerials" }],
      ["PATCH", `/api/v1/brands/${PARTNER_ID}`, { website: "a.example" }],
      ["DELETE", `/api/v1/brands/${PARTNER_ID}`, null],
    ]);
  });

  it("sets and clears a logo slot", async () => {
    const { api, requests } = fakeClient([
      { method: "PUT", path: /\/logos\/on_dark$/, body: { ...partnerBrand, logo_on_dark: "logo-1111111111111111" } },
      { method: "DELETE", path: /\/logos\/flat$/, body: partnerBrand },
    ]);
    const b = await setBrandLogo(api, EAND_ID, "on_dark", "C:\\logos\\white.png");
    await clearBrandLogo(api, EAND_ID, "flat");
    expect(logoIdOf(b, "on_dark")).toBe("logo-1111111111111111");
    expect(logoIdOf(b, "flat")).toBeNull();
    expect(requests[0]).toMatchObject({
      method: "PUT",
      url: `/api/v1/brands/${EAND_ID}/logos/on_dark`,
      body: { path: "C:\\logos\\white.png" },
    });
    expect(requests[1].url).toBe(`/api/v1/brands/${EAND_ID}/logos/flat`);
  });

  it("knows the name-taken refusal", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/brands$/,
        status: 409,
        body: errorBody("brand_name_taken", "There is already a brand called e&.", { brand_id: EAND_ID }),
      },
    ]);
    const err = await createBrand(api, { name: "E&" }).catch((e: unknown) => e);
    expect(isBrandNameTaken(err)).toBe(true);
    expect(isBrandNameTaken(new Error("x"))).toBe(false);
  });
});

describe("brand helpers", () => {
  it("builds a cache-busted logo URL with the token for an img src", () => {
    expect(brandLogoUrl(EAND_ID, "on_dark", "logo-aa")).toBe(
      `/api/v1/brands/${EAND_ID}/logos/on_dark?v=logo-aa`,
    );
    expect(brandLogoUrl(EAND_ID, "flat", "logo-bb", { baseUrl: "http://127.0.0.1:8000/", token: "t k" })).toBe(
      `http://127.0.0.1:8000/api/v1/brands/${EAND_ID}/logos/flat?v=logo-bb&token=t+k`,
    );
  });

  it("fills year and customer, and says the client when there is none", () => {
    expect(formatConfidentiality("© {year} e&.", 2026, "DAMAC")).toBe("© 2026 e&.");
    expect(formatConfidentiality("Prepared for {customer}.", 2026, "DAMAC")).toBe("Prepared for DAMAC.");
    expect(formatConfidentiality("Prepared for {customer}.", 2026, "  ")).toBe("Prepared for the client.");
    expect(formatConfidentiality("Prepared for {customer}.", 2026, null)).toBe("Prepared for the client.");
  });
});
```

Create `frontend/src/api/useBrands.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ApiClient } from "@contract/client";
import { errorBody, fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { PARTNER_ID, eandBrand, exampleBrands, partnerBrand } from "@/test/brandFixtures";
import { useBrandLogoSrc, useBrands } from "./brands";

const wrap =
  (api: ApiClient) =>
  ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;

describe("useBrands", () => {
  it("loads, replaces, adds and removes", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/brands$/, body: { items: exampleBrands } }]);
    const { result } = renderHook(() => useBrands(), { wrapper: wrap(api) });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.brands).toHaveLength(3);
    act(() => result.current.replace({ ...partnerBrand, name: "Orbit" }));
    expect(result.current.brands[2].name).toBe("Orbit");
    act(() => result.current.add({ ...partnerBrand, id: "new", name: "Zain" }));
    expect(result.current.brands.map((b) => b.id)).toContain("new");
    act(() => result.current.remove(PARTNER_ID));
    expect(result.current.brands.map((b) => b.id)).not.toContain(PARTNER_ID);
  });

  it("is unavailable on 501 and shows an error otherwise", async () => {
    const stub = fakeClient([
      { method: "GET", path: /\/brands$/, status: 501, body: errorBody("not_implemented", "later") },
    ]);
    const a = renderHook(() => useBrands(), { wrapper: wrap(stub.api) });
    await waitFor(() => expect(a.result.current.unavailable).toBe(true));
    expect(a.result.current.error).toBeNull();
    const down = fakeClient([
      {
        method: "GET",
        path: /\/brands$/,
        status: 503,
        body: errorBody("catalogue_unavailable", "The catalogue could not be opened."),
      },
    ]);
    const b = renderHook(() => useBrands(), { wrapper: wrap(down.api) });
    await waitFor(() => expect(b.result.current.error).toBe("The catalogue could not be opened."));
  });
});

describe("useBrandLogoSrc", () => {
  it("answers a URL for a set slot and null for an empty one", () => {
    const { api } = fakeClient([]);
    const { result } = renderHook(() => useBrandLogoSrc(), { wrapper: wrap(api) });
    expect(result.current(partnerBrand, "on_dark")).toBe(
      `http://fake/api/v1/brands/${PARTNER_ID}/logos/on_dark?v=logo-0123456789abcdef&token=t`,
    );
    expect(result.current(eandBrand, "on_dark")).toBeNull();
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm -C frontend exec vitest run src/api/brands.test.ts src/api/useBrands.test.tsx`
Expected: FAIL, `Failed to resolve import "./brands"`.

- [ ] **Step 4: Write the module**

Create `frontend/src/api/brands.ts`:

```ts
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
export function setBrandLogo(api: ApiClient, brandId: string, slot: BrandLogoSlot, path: string): Promise<Brand> {
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
```

- [ ] **Step 5: Run the tests**

Run: `pnpm -C frontend exec vitest run src/api/brands.test.ts src/api/useBrands.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add frontend/src/api/brands.ts frontend/src/test/brandFixtures.ts frontend/src/api/brands.test.ts frontend/src/api/useBrands.test.tsx
git commit -m "brands: api module, useBrands and logo URLs (asset findings U6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The cover block takes a brand

**Files:**
- Modify: `frontend/src/reports/preview/PreviewContext.ts`
- Modify: `frontend/src/reports/preview/blocks/CoverBlock.tsx`
- Create: `frontend/src/reports/preview/coverBrand.ts`
- Test: `frontend/src/reports/preview/blocks/blocks.test.tsx` (new cases), `frontend/src/reports/preview/coverBrand.test.ts` (new)

**Interfaces:**
- Consumes: D2's `withBrand(theme, brand)`, `PRINT_THEME`; `Brand` (Task 1).
- Produces:
  - `CoverBrand {gradient: readonly string[]; fontFamily: string | null; logoSrc: string | null}` exported from `PreviewContext.ts`; `PreviewEnv.brand?: CoverBrand | null` (optional, so every existing `PreviewEnv` literal still type-checks).
  - `coverBrandOf(brand: Brand, logoSrc: string | null): CoverBrand`.
  - `CoverBlock`:
    - no brand: renders exactly as today;
    - with a brand: the band background is the brand gradient and the title uses the brand text font;
    - a brand `logoSrc` renders as `<img alt="Brand logo" data-brand-logo>` at the band's bottom left, and hides on a load error;
    - the report's own logo chip (top right) is unchanged.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/reports/preview/coverBrand.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eandBrand, partnerBrand } from "@/test/brandFixtures";
import { coverBrandOf } from "./coverBrand";

describe("coverBrandOf", () => {
  it("takes the gradient from the shared overlay rules and the text font", () => {
    expect(coverBrandOf(eandBrand, "src://logo")).toEqual({
      gradient: ["#141D2D", "#141D2D", "#9E0000"],
      fontFamily: "Nunito Sans",
      logoSrc: "src://logo",
    });
  });

  it("leaves the font to the theme when the brand has none", () => {
    expect(coverBrandOf(partnerBrand, null).fontFamily).toBeNull();
  });
});
```

Append to `frontend/src/reports/preview/blocks/blocks.test.tsx` (it already imports `render`, `screen`, `fireEvent`, `ReactNode`, `PreviewEnvContext`, `CoverBlock` and defines `cover`):

```tsx
describe("CoverBlock with a brand (spec 2026-10-02-asset-findings §9 brand editor preview)", () => {
  const branded =
    (brand: { gradient: string[]; fontFamily: string | null; logoSrc: string | null }) =>
    ({ children }: { children: ReactNode }) => (
      <PreviewEnvContext.Provider
        value={{ resolveSnapshot: () => null, resolveAsset: () => null, scrollRoot: null, paper: "A4", brand }}
      >
        {children}
      </PreviewEnvContext.Provider>
    );

  it("paints the band in the brand gradient and sets the title font", () => {
    const { container } = render(<CoverBlock block={cover} />, {
      wrapper: branded({ gradient: ["#141D2D", "#141D2D", "#9E0000"], fontFamily: "Nunito Sans", logoSrc: null }),
    });
    const band = container.querySelector("[data-cover-band]") as HTMLElement;
    expect(band.style.background).toContain("rgb(20, 29, 45)");
    expect(band.style.background).toContain("rgb(158, 0, 0)");
    expect(screen.getByText("North yard inspection").style.fontFamily).toContain("Nunito Sans");
    expect(screen.queryByRole("img", { name: "Brand logo" })).toBeNull();
  });

  it("shows the brand logo and hides it when it fails to load", () => {
    render(<CoverBlock block={cover} />, {
      wrapper: branded({ gradient: ["#000000", "#000000", "#000000"], fontFamily: null, logoSrc: "brand://dark" }),
    });
    const img = screen.getByRole("img", { name: "Brand logo" });
    expect(img).toHaveAttribute("src", "brand://dark");
    fireEvent.error(img);
    expect(screen.queryByRole("img", { name: "Brand logo" })).toBeNull();
  });

  it("keeps the Kestrel gradient without a brand", () => {
    const { container } = render(<CoverBlock block={cover} />);
    const band = container.querySelector("[data-cover-band]") as HTMLElement;
    expect(band.style.background).toContain("rgb(59, 42, 122)"); // #3B2A7A
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm -C frontend exec vitest run src/reports/preview/coverBrand.test.ts src/reports/preview/blocks/blocks.test.tsx`
Expected: FAIL; `./coverBrand` does not resolve, and the brand band test finds the Kestrel gradient.

- [ ] **Step 3: Extend the preview context**

In `frontend/src/reports/preview/PreviewContext.ts`, add above `PreviewEnv`:

```ts
/** A brand's cover look (spec 2026-10-02-asset-findings §9): built by coverBrandOf from D2's overlay. */
export interface CoverBrand {
  /** Three hex stops for the band's 135° gradient. */
  gradient: readonly string[];
  /** The brand's text font family, or null for the theme font. */
  fontFamily: string | null;
  /** The brand's `on_dark` logo src, or null. */
  logoSrc: string | null;
}
```

and add as the last member of `PreviewEnv`:

```ts
  /** The brand the cover is drawn in; absent or null is the Kestrel theme. */
  brand?: CoverBrand | null;
```

- [ ] **Step 4: Write `coverBrand.ts`**

Create `frontend/src/reports/preview/coverBrand.ts`:

```ts
import type { Brand } from "@/api/brands";
import { PRINT_THEME, withBrand } from "../printTheme";
import type { CoverBrand } from "./PreviewContext";

/** The cover look of a brand, through the same overlay rules the PDF uses (D2's withBrand). */
export function coverBrandOf(brand: Brand, logoSrc: string | null): CoverBrand {
  const theme = withBrand(PRINT_THEME, brand);
  return { gradient: theme.cover.gradient, fontFamily: brand.font_text, logoSrc };
}
```

- [ ] **Step 5: Draw the brand in `CoverBlock`**

In `frontend/src/reports/preview/blocks/CoverBlock.tsx`, replace the body of `CoverBlock` with:

```tsx
export function CoverBlock({ block }: { block: BlockOf<"cover"> }) {
  const env = usePreviewEnv();
  const brand = env.brand ?? null;
  const logoSrc = block.logo ? env.resolveAsset(block.logo.asset_id) : null;
  // The src that failed to load: its chip is hidden (no broken-image icon on the cover); a new src shows again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showLogo = logoSrc !== null && logoSrc !== failedSrc;
  const brandLogo = brand?.logoSrc ?? null;
  const showBrandLogo = brandLogo !== null && brandLogo !== failedSrc;
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
        <p
          style={{
            ...textStyle(PRINT.size.coverTitle, PRINT.paper),
            fontWeight: 600,
            margin: 0,
            fontFamily: titleFont,
          }}
        >
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
            onError={() => setFailedSrc(brandLogo)}
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
```

Update the docstring's first sentence to end "... and (when resolvable) the logo, in the report's brand when the preview has one (spec 2026-10-02-asset-findings §9)".

- [ ] **Step 6: Run the tests**

Run: `pnpm -C frontend exec vitest run src/reports/preview src/reports/ReportPreview.test.tsx`
Expected: PASS (the existing CoverBlock and preview tests are unchanged).

- [ ] **Step 7: Commit**

```
git add frontend/src/reports/preview/PreviewContext.ts frontend/src/reports/preview/coverBrand.ts frontend/src/reports/preview/coverBrand.test.ts frontend/src/reports/preview/blocks/CoverBlock.tsx frontend/src/reports/preview/blocks/blocks.test.tsx
git commit -m "reports: the cover preview takes a brand gradient, font and logo (asset findings U6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The brand draft model

**Files:**
- Create: `frontend/src/settings/brands/brandDraft.ts`
- Test: `frontend/src/settings/brands/brandDraft.test.ts`

**Interfaces:**
- Produces:
  - `COLOUR_KEYS: readonly (keyof BrandColors)[]` (`accent, accent_dark, navy, ink, pale, line`)
  - `COLOUR_LABELS: Record<keyof BrandColors, string>`: Accent, Accent dark, Navy, Ink, Pale, Line
  - `BrandDraft {name, colors: BrandColors, font_text: string | null, font_numerals: string | null, website, owner, confidentiality, pdf_author}`
  - `draftOf(brand: Brand): BrandDraft`
  - `DraftErrors {name?: string; colors: Partial<Record<keyof BrandColors, string>>}`
  - `draftErrors(d: BrandDraft): DraftErrors`; `hasErrors(e: DraftErrors): boolean`
  - `patchOf(brand: Brand, d: BrandDraft): BrandPatch`: only the changed fields. Colours are compared case-insensitively, and all six are sent upper case if any changed. Names and text are trimmed (names also lose repeated spaces).
  - `previewOf(brand: Brand, d: BrandDraft): Brand`: the brand as drawn live. A valid draft colour replaces the saved one; an invalid one keeps the saved one.
  - `nextBrandName(names: string[]): string`: "New brand", then "New brand 2", and so on, case-insensitive.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/settings/brands/brandDraft.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eandBrand, partnerBrand } from "@/test/brandFixtures";
import { draftErrors, draftOf, hasErrors, nextBrandName, patchOf, previewOf } from "./brandDraft";

describe("brandDraft", () => {
  it("starts from the saved brand and patches nothing", () => {
    const d = draftOf(eandBrand);
    expect(d.name).toBe("e&");
    expect(patchOf(eandBrand, d)).toEqual({});
    expect(hasErrors(draftErrors(d))).toBe(false);
  });

  it("patches only what changed, trimmed, colours upper case and all six", () => {
    const d = draftOf(eandBrand);
    d.name = "  e&   drones ";
    d.colors = { ...d.colors, accent: "#00aa55" };
    d.website = " www.eand.com ";
    d.font_numerals = null;
    expect(patchOf(eandBrand, d)).toEqual({
      name: "e& drones",
      colors: { ...eandBrand.colors, accent: "#00AA55" },
      font_numerals: null,
    });
  });

  it("does not patch a colour that differs only in case", () => {
    const d = draftOf(eandBrand);
    d.colors = { ...d.colors, navy: "#141d2d" };
    expect(patchOf(eandBrand, d)).toEqual({});
  });

  it("flags a blank name and a malformed colour", () => {
    const d = draftOf(eandBrand);
    d.name = "   ";
    d.colors = { ...d.colors, pale: "#ffe5e" };
    const e = draftErrors(d);
    expect(e.name).toBe("A brand needs a name.");
    expect(e.colors).toEqual({ pale: "Use a colour like #1F4FD1." });
    expect(hasErrors(e)).toBe(true);
  });

  it("previews valid draft colours and keeps the saved one for an invalid entry", () => {
    const d = draftOf(eandBrand);
    d.colors = { ...d.colors, navy: "#000000", accent: "#12" };
    d.font_text = "Inter";
    const p = previewOf(eandBrand, d);
    expect(p.colors.navy).toBe("#000000");
    expect(p.colors.accent).toBe("#BC0000");
    expect(p.font_text).toBe("Inter");
    expect(p.logo_on_dark).toBe(eandBrand.logo_on_dark);
  });

  it("names a new brand after the ones that exist", () => {
    expect(nextBrandName(["e&", "White label"])).toBe("New brand");
    expect(nextBrandName(["new brand", "New brand 2"])).toBe("New brand 3");
    expect(nextBrandName([partnerBrand.name])).toBe("New brand");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm -C frontend exec vitest run src/settings/brands/brandDraft.test.ts`
Expected: FAIL, `Failed to resolve import "./brandDraft"`.

- [ ] **Step 3: Write the model**

Create `frontend/src/settings/brands/brandDraft.ts`:

```ts
import type { Brand, BrandColors, BrandPatch } from "@/api/brands";

export const COLOUR_KEYS: readonly (keyof BrandColors)[] = ["accent", "accent_dark", "navy", "ink", "pale", "line"];

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
```

- [ ] **Step 4: Run the test**

Run: `pnpm -C frontend exec vitest run src/settings/brands/brandDraft.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add frontend/src/settings/brands/brandDraft.ts frontend/src/settings/brands/brandDraft.test.ts
git commit -m "settings: brand draft model (asset findings U6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: One logo slot: `BrandLogoField`

**Files:**
- Create: `frontend/src/settings/brands/BrandLogoField.tsx`
- Test: `frontend/src/settings/brands/BrandLogoField.test.tsx`

**Interfaces:**
- Consumes: `setBrandLogo`, `clearBrandLogo`, `logoIdOf`, `useBrandLogoSrc` (Task 1); `useApi`, `useBackend`; `@tauri-apps/plugin-dialog` `open`.
- Produces: `<BrandLogoField brand slot label hint onChange={(b: Brand) => void} />`. It:
  - shows the current logo on a chip: paper white for `on_light` and `flat`, the brand navy for `on_dark` (data colour through `--c`);
  - offers "Choose logo" or "Replace logo" (Tauri dialog), or in the browser a path field and "Add logo";
  - offers "Remove logo";
  - reports a failure inline.

Logo changes save at once (they are files, not draft fields), and the parent replaces the brand in its list.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/settings/brands/BrandLogoField.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { errorBody, fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { EAND_ID, PARTNER_ID, eandBrand, partnerBrand } from "@/test/brandFixtures";
import type { Brand } from "@/api/brands";
import { BrandLogoField } from "./BrandLogoField";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => "C:\\logos\\white.png") }));

function setup(brand: Brand, mode: "mock" | "tauri", putStatus = 200) {
  const onChange = vi.fn();
  const { api, requests } = fakeClient([
    {
      method: "PUT",
      path: /\/logos\/on_dark$/,
      status: putStatus,
      body:
        putStatus === 200
          ? { ...brand, logo_on_dark: "logo-2222222222222222" }
          : errorBody("asset_invalid", "white.txt is not a readable PNG, JPEG or WebP image.", {
              reason: "not_an_image",
            }),
    },
    { method: "DELETE", path: /\/logos\/on_dark$/, body: { ...brand, logo_on_dark: null } },
  ]);
  render(
    <TestApiProvider api={api} mode={mode}>
      <BrandLogoField brand={brand} slot="on_dark" label="Logo on dark" hint="White version." onChange={onChange} />
    </TestApiProvider>,
  );
  return { onChange, requests };
}

describe("BrandLogoField", () => {
  it("picks a file in the desktop shell and saves it at once", async () => {
    const { onChange, requests } = setup(eandBrand, "tauri");
    fireEvent.click(screen.getByRole("button", { name: "Choose logo" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(openDialog).toHaveBeenCalled();
    expect(requests[0]).toMatchObject({
      method: "PUT",
      url: `/api/v1/brands/${EAND_ID}/logos/on_dark`,
      body: { path: "C:\\logos\\white.png" },
    });
    expect((onChange.mock.calls[0][0] as Brand).logo_on_dark).toBe("logo-2222222222222222");
  });

  it("takes a path in the browser", async () => {
    const { onChange, requests } = setup(eandBrand, "mock");
    fireEvent.change(screen.getByLabelText("Logo on dark file path"), { target: { value: " C:\\logos\\w.png " } });
    fireEvent.click(screen.getByRole("button", { name: "Add logo" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(requests[0].body).toEqual({ path: "C:\\logos\\w.png" });
  });

  it("shows the current logo on the navy chip and removes it", async () => {
    const { onChange, requests } = setup(partnerBrand, "tauri");
    const img = screen.getByRole("img", { name: "Logo on dark" });
    expect(img).toHaveAttribute(
      "src",
      `http://fake/api/v1/brands/${PARTNER_ID}/logos/on_dark?v=logo-0123456789abcdef&token=t`,
    );
    expect(screen.getByRole("button", { name: "Replace logo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(requests[0]).toMatchObject({ method: "DELETE", url: `/api/v1/brands/${PARTNER_ID}/logos/on_dark` });
  });

  it("reports a refused file inline", async () => {
    setup(eandBrand, "mock", 422);
    fireEvent.change(screen.getByLabelText("Logo on dark file path"), { target: { value: "C:\\white.txt" } });
    fireEvent.click(screen.getByRole("button", { name: "Add logo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not a readable PNG, JPEG or WebP image");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm -C frontend exec vitest run src/settings/brands/BrandLogoField.test.tsx`
Expected: FAIL, `Failed to resolve import "./BrandLogoField"`.

- [ ] **Step 3: Write the component**

Create `frontend/src/settings/brands/BrandLogoField.tsx`:

```tsx
import { useState, type CSSProperties } from "react";
import { useApi, useBackend } from "@/api/client";
import {
  clearBrandLogo,
  logoIdOf,
  setBrandLogo,
  useBrandLogoSrc,
  type Brand,
  type BrandLogoSlot,
} from "@/api/brands";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { PRINT } from "@/reports/printTheme";
import { Button, Input } from "@/ui";

export interface BrandLogoFieldProps {
  brand: Brand;
  slot: BrandLogoSlot;
  label: string;
  hint: string;
  onChange: (brand: Brand) => void;
}

/**
 * One of a brand's three logos (spec 2026-10-02-asset-findings §5.8). Saved at once: a logo is a file
 * the backend copies beside catalogue.db, not a draft field. The chip shows the logo on the ground it
 * prints on: the brand navy for `on_dark`, paper white otherwise (data colours, through `--c`).
 */
export function BrandLogoField({ brand, slot, label, hint, onChange }: BrandLogoFieldProps) {
  const api = useApi();
  const { mode } = useBackend();
  const src = useBrandLogoSrc()(brand, slot);
  const hasLogo = logoIdOf(brand, slot) !== null;
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ground = slot === "on_dark" ? brand.colors.navy : PRINT.paper;

  async function add(file: string) {
    setBusy(true);
    setError(null);
    try {
      onChange(await setBrandLogo(api, brand.id, slot, file));
      setPath("");
    } catch (e) {
      pushLog(`brand logo import failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "Could not add the logo; pick a PNG, JPEG or WebP under 20 MB."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      onChange(await clearBrandLogo(api, brand.id, slot));
    } catch (e) {
      setError(messageOf(e, "Could not remove the logo."));
    } finally {
      setBusy(false);
    }
  }

  async function pick() {
    setError(null);
    let picked: unknown;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      picked = await open({ multiple: false, filters: [{ name: "Logo", extensions: ["png", "jpg", "jpeg", "webp"] }] });
    } catch (e) {
      pushLog(`brand logo dialog failed: ${messageOf(e, String(e))}`);
      setError("The file dialog did not open. Try again.");
      return;
    }
    if (typeof picked === "string") await add(picked);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="flex items-center gap-3">
        <span
          className="flex h-12 w-28 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-line bg-[var(--c)] p-1"
          style={{ "--c": ground } as CSSProperties}
        >
          {src ? (
            <img src={src} alt={label} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-2xs text-muted">No logo</span>
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {mode === "tauri" ? (
            <Button size="sm" icon="import" loading={busy} onClick={() => void pick()}>
              {hasLogo ? "Replace logo" : "Choose logo"}
            </Button>
          ) : (
            <>
              <Input
                aria-label={`${label} file path`}
                dense
                value={path}
                placeholder={"C:\\logos\\brand.png"}
                onChange={(e) => setPath(e.target.value)}
                className="min-w-0 flex-1"
              />
              <Button size="sm" loading={busy} disabled={!path.trim()} onClick={() => void add(path.trim())}>
                Add logo
              </Button>
            </>
          )}
          {hasLogo && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
              Remove logo
            </Button>
          )}
        </div>
      </div>
      <p className="text-2xs text-muted">{hint}</p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm -C frontend exec vitest run src/settings/brands/BrandLogoField.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add frontend/src/settings/brands/BrandLogoField.tsx frontend/src/settings/brands/BrandLogoField.test.tsx
git commit -m "settings: brand logo slot with the desktop picker or a path (asset findings U6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Brand editor, live cover preview, and the section in App settings

**Files:**
- Create: `frontend/src/settings/brands/BrandCoverPreview.tsx`
- Create: `frontend/src/settings/brands/BrandEditor.tsx`
- Create: `frontend/src/settings/brands/BrandsSection.tsx`
- Modify: `frontend/src/screens/AppSettingsScreen.tsx`
- Test: `frontend/src/settings/brands/BrandsSection.test.tsx`, `frontend/src/screens/AppSettingsScreen.test.tsx` (one case)

**Interfaces:**
- Consumes: Tasks 1 to 4; `CoverBlock`, `PreviewEnvContext`, `mm`, `mmVar`, `PRINT`, `textStyle` from the reports preview; `ColourSwatch` from `@/catalogue/ColourSwatch`; `Alert`, `Button`, `Dialog`, `Field`, `GlassPanel`, `Input`, `Pill`, `Select`, `Skeleton`, `Textarea`, `cx`, `focusRing` from `@/ui`.
- Produces:
  - `<BrandsSection />` (heading "Report brands") mounted in `AppSettingsScreen` after Providers.
  - `<BrandEditor brand onChange onDeleted />`.
  - `<BrandCoverPreview brand />`: `role="img"` is not used; the figure is labelled "Cover preview", and the sheet has `data-testid="brand-cover-preview"`.

UI copy (verbatim):
- Section heading "Report brands"; description "Colours, fonts, logos and footer text a report can print with. Pick one in a report's settings."
- List label "Brands"; button "New brand"; pill "Built in".
- Field "Name", then editor regions "Colours", "Fonts", "Logos", "Footer and document".
- Font select labels "Text font" and "Numerals font"; the option "Report default".
- Logo labels and hints:
  - "Logo on light": "For white bars and the report header.";
  - "Logo on dark": "A white version for the cover band.";
  - "Flat logo": "No transparency; used in the PDF running header.".
- Text labels "Website", "Owner", "PDF author", "Confidentiality line", with the hint "Use {year} and {customer}; they are filled in when the report renders."
- Buttons "Save brand", "Delete brand"; status "Saved".
- Built-in note "Built-in brands can be edited but not deleted."
- Delete dialog: title "Delete {name}?", body "Reports that use it will print with the Kestrel theme.", buttons "Cancel" and "Delete brand".
- Preview caption "The preview uses fonts installed on this computer; the PDF embeds the brand fonts."
- Unavailable note "Brands are not available yet."

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/settings/brands/BrandsSection.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { errorBody, fakeClient, type FakeRoute } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { EAND_ID, PARTNER_ID, eandBrand, exampleBrands, partnerBrand } from "@/test/brandFixtures";
import type { Brand } from "@/api/brands";
import { BrandsSection } from "./BrandsSection";

function setup(extra: FakeRoute[] = []) {
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/api\/v1\/brands$/, body: { items: exampleBrands } },
    ...extra,
  ]);
  renderWithProviders(<BrandsSection />, { api });
  return requests;
}

const band = () =>
  screen.getByTestId("brand-cover-preview").querySelector("[data-cover-band]") as HTMLElement;

describe("BrandsSection", () => {
  it("lists the brands and opens the first, built in, without a delete button", async () => {
    setup();
    const list = await screen.findByRole("list", { name: "Brands" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "e&Built in",
      "White labelBuilt in",
      "Orbit Aerials",
    ]);
    expect(screen.getByLabelText("Name")).toHaveValue("e&");
    expect(screen.getByText("Built-in brands can be edited but not deleted.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete brand" })).toBeNull();
    expect(band().style.background).toContain("rgb(20, 29, 45)"); // e& navy
  });

  it("updates the preview live as a colour is typed, and saves only the change", async () => {
    const requests = setup([
      {
        method: "PATCH",
        path: /\/brands\/[^/]+$/,
        body: (req) => ({ ...eandBrand, ...(req.body as Partial<Brand>), updated_at: "2026-10-03T01:00:00Z" }),
      },
    ]);
    const field = await screen.findByLabelText("Accent dark hex");
    fireEvent.change(field, { target: { value: "#00aa55" } });
    expect(band().style.background).toContain("rgb(0, 170, 85)");
    fireEvent.change(field, { target: { value: "#00aa5" } }); // half typed: the preview keeps the last good colour
    expect(screen.getByText("Use a colour like #1F4FD1.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save brand" })).toBeDisabled();
    fireEvent.change(field, { target: { value: "#00aa55" } });
    fireEvent.click(screen.getByRole("button", { name: "Save brand" }));
    await screen.findByText("Saved");
    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.url).toBe(`/api/v1/brands/${EAND_ID}`);
    expect(patch?.body).toEqual({ colors: { ...eandBrand.colors, accent_dark: "#00AA55" } });
  });

  it("shows the footer line with the year and a sample client", async () => {
    setup();
    await screen.findByLabelText("Name");
    fireEvent.click(screen.getByRole("button", { name: /White label/ }));
    const footer = screen.getByTestId("brand-cover-preview").querySelector("[data-brand-footer]");
    expect(footer?.textContent).toContain("Prepared for Sample client.");
  });

  it("refuses a taken name inline", async () => {
    setup([
      {
        method: "PATCH",
        path: /\/brands\/[^/]+$/,
        status: 409,
        body: errorBody("brand_name_taken", "There is already a brand called White label.", {
          brand_id: "builtin-white-label",
        }),
      },
    ]);
    await screen.findByLabelText("Name");
    fireEvent.click(screen.getByRole("button", { name: "Orbit Aerials" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "white label" } });
    fireEvent.click(screen.getByRole("button", { name: "Save brand" }));
    expect(await screen.findByText("There is already a brand called White label.")).toBeInTheDocument();
  });

  it("creates a brand with the next free name and selects it", async () => {
    const created: Brand = { ...partnerBrand, id: "new-1", name: "New brand", logo_on_dark: null };
    const requests = setup([{ method: "POST", path: /\/brands$/, status: 201, body: created }]);
    await screen.findByLabelText("Name");
    fireEvent.click(screen.getByRole("button", { name: "New brand" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("New brand"));
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({ name: "New brand" });
  });

  it("deletes a custom brand after confirming", async () => {
    const requests = setup([{ method: "DELETE", path: /\/brands\/[^/]+$/, status: 204, body: null }]);
    await screen.findByLabelText("Name");
    fireEvent.click(screen.getByRole("button", { name: "Orbit Aerials" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete brand" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Orbit Aerials?" });
    expect(within(dialog).getByText("Reports that use it will print with the Kestrel theme.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete brand" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Orbit Aerials" })).toBeNull());
    expect(requests.find((r) => r.method === "DELETE")?.url).toBe(`/api/v1/brands/${PARTNER_ID}`);
    expect(screen.getByLabelText("Name")).toHaveValue("e&");
  });

  it("says brands are not available on 501", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/brands$/, status: 501, body: errorBody("not_implemented", "later") },
    ]);
    renderWithProviders(<BrandsSection />, { api });
    expect(await screen.findByText("Brands are not available yet.")).toBeInTheDocument();
  });
});
```

Append to `frontend/src/screens/AppSettingsScreen.test.tsx` inside the `describe`:

```tsx
  it("has the report brands section", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
      { method: "GET", path: /\/api\/v1\/brands$/, body: { items: [] } },
    ]);
    renderWithProviders(<AppSettingsScreen />, { api, route: "/settings", path: "/settings" });
    expect(screen.getByRole("heading", { name: "Report brands" })).toBeInTheDocument();
  });
```

(`FakeRoute` is exported from `@/test/fixtures`; if it is not, export the existing route interface under that name in the same commit.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm -C frontend exec vitest run src/settings/brands/BrandsSection.test.tsx src/screens/AppSettingsScreen.test.tsx`
Expected: FAIL, `Failed to resolve import "./BrandsSection"`, and no "Report brands" heading.

- [ ] **Step 3: Write the cover preview**

Create `frontend/src/settings/brands/BrandCoverPreview.tsx`:

```tsx
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
  const footer = [brand.website, formatConfidentiality(brand.confidentiality, new Date().getFullYear(), SAMPLE_CLIENT)]
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
```

- [ ] **Step 4: Write the editor**

Create `frontend/src/settings/brands/BrandEditor.tsx`:

```tsx
import { useId, useState, type ReactNode } from "react";
import { useApi } from "@/api/client";
import { BRAND_FONTS, deleteBrand, isBrandNameTaken, patchBrand, type Brand, type BrandLogoSlot } from "@/api/brands";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { ColourSwatch } from "@/catalogue/ColourSwatch";
import { Alert, Button, Dialog, Field, GlassPanel, Input, Pill, Select, Textarea } from "@/ui";
import { BrandCoverPreview } from "./BrandCoverPreview";
import { BrandLogoField } from "./BrandLogoField";
import {
  COLOUR_KEYS,
  COLOUR_LABELS,
  draftErrors,
  draftOf,
  hasErrors,
  patchOf,
  previewOf,
  type BrandDraft,
} from "./brandDraft";

const LOGOS: { slot: BrandLogoSlot; label: string; hint: string }[] = [
  { slot: "on_light", label: "Logo on light", hint: "For white bars and the report header." },
  { slot: "on_dark", label: "Logo on dark", hint: "A white version for the cover band." },
  { slot: "flat", label: "Flat logo", hint: "No transparency; used in the PDF running header." },
];

function Region({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-sm font-semibold text-ink">
        {title}
      </h3>
      {children}
    </section>
  );
}

function FontSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} dense value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Report default</option>
        {BRAND_FONTS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export interface BrandEditorProps {
  brand: Brand;
  onChange: (brand: Brand) => void;
  onDeleted: (brandId: string) => void;
}

/** Spec 2026-10-02-asset-findings §9 brand editor. Keyed by brand id in BrandsSection, so switching
 * brands starts a fresh draft; logo changes (saved at once) do not reset the draft. */
export function BrandEditor({ brand, onChange, onDeleted }: BrandEditorProps) {
  const api = useApi();
  const [draft, setDraft] = useState<BrandDraft>(() => draftOf(brand));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const errors = draftErrors(draft);
  const patch = patchOf(brand, draft);
  const dirty = Object.keys(patch).length > 0;
  const edit = (change: Partial<BrandDraft>) => {
    setDraft((d) => ({ ...d, ...change }));
    setSaved(false);
    if ("name" in change) setNameError(null);
  };

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const next = await patchBrand(api, brand.id, patch);
      onChange(next);
      setDraft(draftOf(next));
      setSaved(true);
    } catch (e) {
      pushLog(`brand save failed: ${messageOf(e, String(e))}`);
      if (isBrandNameTaken(e)) setNameError(messageOf(e, "That name is taken."));
      else setError(messageOf(e, "The brand could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await deleteBrand(api, brand.id);
      setConfirming(false);
      onDeleted(brand.id);
    } catch (e) {
      setConfirming(false);
      setError(messageOf(e, "The brand could not be deleted."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
      <GlassPanel variant="pane" className="flex min-w-0 flex-col gap-5 p-4">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-base font-semibold">{brand.name}</h3>
          {brand.builtin && <Pill tone="accent">Built in</Pill>}
        </div>
        {brand.builtin && <p className="text-xs text-muted">Built-in brands can be edited but not deleted.</p>}
        {error && <Alert tone="danger">{error}</Alert>}

        {/* No Region wrapper: a section labelled "Name" would also match getByLabelText("Name"). */}
        <Field label="Name" htmlFor="brand-name" error={nameError ?? errors.name}>
          <Input
            id="brand-name"
            dense
            value={draft.name}
            invalid={Boolean(nameError ?? errors.name)}
            onChange={(e) => edit({ name: e.target.value })}
          />
        </Field>

        <Region title="Colours">
          <div className="grid grid-cols-2 gap-3">
            {COLOUR_KEYS.map((key) => (
              <Field key={key} label={COLOUR_LABELS[key]} htmlFor={`brand-colour-${key}`} error={errors.colors[key]}>
                <div className="flex items-center gap-2">
                  <ColourSwatch
                    label={`${COLOUR_LABELS[key]} colour`}
                    value={/^#[0-9a-f]{6}$/i.test(draft.colors[key]) ? draft.colors[key] : brand.colors[key]}
                    onChange={(c) => edit({ colors: { ...draft.colors, [key]: c.toUpperCase() } })}
                  />
                  <Input
                    id={`brand-colour-${key}`}
                    aria-label={`${COLOUR_LABELS[key]} hex`}
                    dense
                    value={draft.colors[key]}
                    invalid={Boolean(errors.colors[key])}
                    onChange={(e) => edit({ colors: { ...draft.colors, [key]: e.target.value.trim() } })}
                    className="font-mono"
                  />
                </div>
              </Field>
            ))}
          </div>
        </Region>

        <Region title="Fonts">
          <div className="grid grid-cols-2 gap-3">
            <FontSelect id="brand-font-text" label="Text font" value={draft.font_text} onChange={(v) => edit({ font_text: v })} />
            <FontSelect
              id="brand-font-numerals"
              label="Numerals font"
              value={draft.font_numerals}
              onChange={(v) => edit({ font_numerals: v })}
            />
          </div>
        </Region>

        <Region title="Logos">
          {LOGOS.map((l) => (
            <BrandLogoField key={l.slot} brand={brand} slot={l.slot} label={l.label} hint={l.hint} onChange={onChange} />
          ))}
        </Region>

        <Region title="Footer and document">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Website" htmlFor="brand-website">
              <Input id="brand-website" dense value={draft.website} onChange={(e) => edit({ website: e.target.value })} />
            </Field>
            <Field label="Owner" htmlFor="brand-owner">
              <Input id="brand-owner" dense value={draft.owner} onChange={(e) => edit({ owner: e.target.value })} />
            </Field>
          </div>
          <Field label="PDF author" htmlFor="brand-pdf-author">
            <Input
              id="brand-pdf-author"
              dense
              value={draft.pdf_author}
              onChange={(e) => edit({ pdf_author: e.target.value })}
            />
          </Field>
          <Field
            label="Confidentiality line"
            htmlFor="brand-confidentiality"
            hint="Use {year} and {customer}; they are filled in when the report renders."
          >
            <Textarea
              id="brand-confidentiality"
              rows={3}
              value={draft.confidentiality}
              onChange={(e) => edit({ confidentiality: e.target.value })}
            />
          </Field>
        </Region>

        <div className="flex items-center gap-2 border-t border-line pt-4">
          <Button
            variant="primary"
            loading={saving}
            disabled={!dirty || hasErrors(errors)}
            onClick={() => void save()}
          >
            Save brand
          </Button>
          {saved && !dirty && (
            <span role="status" className="text-xs text-muted">
              Saved
            </span>
          )}
          <span className="flex-1" />
          {!brand.builtin && (
            <Button variant="danger" icon="trash" onClick={() => setConfirming(true)}>
              Delete brand
            </Button>
          )}
        </div>
      </GlassPanel>

      <BrandCoverPreview brand={previewOf(brand, draft)} />

      <Dialog
        open={confirming}
        title={`Delete ${brand.name}?`}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void remove()}>
              Delete brand
            </Button>
          </>
        }
      >
        <p className="text-sm">Reports that use it will print with the Kestrel theme.</p>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 5: Write the section**

Create `frontend/src/settings/brands/BrandsSection.tsx`:

```tsx
import { useState } from "react";
import { useApi } from "@/api/client";
import { createBrand, useBrands } from "@/api/brands";
import { messageOf } from "@/api/errors";
import { Alert, Button, GlassPanel, Pill, Skeleton, cx, focusRing } from "@/ui";
import { BrandEditor } from "./BrandEditor";
import { nextBrandName } from "./brandDraft";

/** App settings → Report brands (spec 2026-10-02-asset-findings §9): the list, then the editor. */
export function BrandsSection() {
  const api = useApi();
  const list = useBrands();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = list.brands.find((b) => b.id === selectedId) ?? list.brands[0] ?? null;

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const b = await createBrand(api, { name: nextBrandName(list.brands.map((x) => x.name)) });
      list.add(b);
      setSelectedId(b.id);
    } catch (e) {
      setError(messageOf(e, "The brand could not be created."));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="flex flex-col gap-5 py-6" aria-labelledby="brands-title">
      <div className="flex flex-col gap-1">
        <h2 id="brands-title" className="text-lg font-semibold">
          Report brands
        </h2>
        <p className="text-sm text-muted">
          Colours, fonts, logos and footer text a report can print with. Pick one in a report&apos;s settings.
        </p>
      </div>
      {list.unavailable && <Alert tone="info">Brands are not available yet.</Alert>}
      {list.error && <Alert tone="danger">{list.error}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {list.loading ? (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading brands">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : list.unavailable || list.error ? null : (
        <div className="grid grid-cols-[12rem_minmax(0,1fr)] items-start gap-4">
          <GlassPanel variant="pane" className="flex flex-col gap-2 p-2">
            <ul aria-label="Brands" className="flex flex-col gap-0.5">
              {list.brands.map((b) => {
                const active = selected?.id === b.id;
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      aria-current={active || undefined}
                      onClick={() => setSelectedId(b.id)}
                      className={cx(
                        "flex w-full items-center justify-between gap-2 rounded-control px-2.5 py-1.5 text-left text-sm",
                        focusRing,
                        active ? "bg-accent-soft text-accent-ink" : "text-ink hover:bg-surface-2",
                      )}
                    >
                      <span className="min-w-0 truncate">{b.name}</span>
                      {b.builtin && (
                        <Pill size="sm" tone="neutral">
                          Built in
                        </Pill>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <Button size="sm" icon="plus" loading={creating} onClick={() => void create()}>
              New brand
            </Button>
          </GlassPanel>
          {selected && (
            <BrandEditor
              key={selected.id}
              brand={selected}
              onChange={list.replace}
              onDeleted={(id) => {
                list.remove(id);
                setSelectedId(null);
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Mount it in App settings**

In `frontend/src/screens/AppSettingsScreen.tsx`, add `import { BrandsSection } from "@/settings/brands/BrandsSection";` and render `<BrandsSection />` after `<ProvidersSection />` inside the `divide-y` block. Change the screen description to "Settings for this computer, used by all projects: appearance, provider keys and report brands."

- [ ] **Step 7: Run the tests**

Run: `pnpm -C frontend exec vitest run src/settings/brands src/screens/AppSettingsScreen.test.tsx`
Expected: PASS.

Run: `pnpm -C frontend lint`
Expected: PASS (ESLint, `tsc` and `check-tokens`: brand colours reach CSS only through `style`, and the one class with a colour is `bg-[var(--c)]`).

- [ ] **Step 8: Commit**

```
git add frontend/src/settings/brands/BrandCoverPreview.tsx frontend/src/settings/brands/BrandEditor.tsx frontend/src/settings/brands/BrandsSection.tsx frontend/src/settings/brands/BrandsSection.test.tsx frontend/src/screens/AppSettingsScreen.tsx frontend/src/screens/AppSettingsScreen.test.tsx
git commit -m "settings: report brands editor with a live cover preview (asset findings U6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add `frontend/src/test/fixtures.ts` if Step 1 exported `FakeRoute`.)

---

### Task 6: The brand picker in the report builder, and the builder preview in that brand

**Files:**
- Modify: `frontend/src/reports/ReportSettings.tsx`
- Modify: `frontend/src/reports/ReportPreview.tsx`
- Modify: `frontend/src/reports/ReportBuilder.tsx`
- Test: `frontend/src/reports/ReportSettings.test.tsx` (new cases), `frontend/src/reports/ReportPreview.test.tsx` (one case)

**Interfaces:**
- Consumes: `useBrands`, `useBrandLogoSrc`, `Brand` (Task 1); `coverBrandOf`, `CoverBrand` (Task 2); C0's `ReportConfig.brand_id: string | null`.
- Produces:
  - `ReportSettingsProps.brands?: Brand[] | null` (null or absent while loading). The Cover region gains the "Brand" select. "Kestrel theme" writes `brand_id: null`; a brand writes its id. When the list is loaded but lacks the saved id, a disabled option "Brand not found (Kestrel theme)" keeps the value visible.
  - `ReportPreviewProps.brand?: CoverBrand | null`, put on the preview env.
  - `ReportBuilder` resolves the draft's and the viewed version's `brand_id` to a `CoverBrand`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/reports/ReportSettings.test.tsx`. First read the existing `setup` in that file. Extend it with an optional `brands` argument passed through to `<ReportSettings brands={opts.brands} ... />`, then add:

```tsx
describe("ReportSettings brand picker (spec 2026-10-02-asset-findings §5.8)", () => {
  it("offers the Kestrel theme and every brand, and writes brand_id", () => {
    const { latest } = setup({ brands: exampleBrands });
    const select = screen.getByLabelText("Brand");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Kestrel theme",
      "e&",
      "White label",
      "Orbit Aerials",
    ]);
    fireEvent.change(select, { target: { value: EAND_ID } });
    expect(latest().brand_id).toBe(EAND_ID);
    fireEvent.change(select, { target: { value: "" } });
    expect(latest().brand_id).toBeNull();
  });

  it("keeps a deleted brand's id visible as not found", () => {
    setup({ brands: exampleBrands, config: reportConfig({ brand_id: "gone" }) });
    expect(screen.getByRole("option", { name: "Brand not found (Kestrel theme)" })).toBeDisabled();
    expect(screen.getByLabelText("Brand")).toHaveValue("gone");
  });

  it("shows only the Kestrel theme while brands load", () => {
    setup({ brands: null });
    expect(within(screen.getByLabelText("Brand")).getAllByRole("option")).toHaveLength(1);
  });
});
```

with imports `import { EAND_ID, exampleBrands } from "@/test/brandFixtures";` and `import type { Brand } from "@/api/brands";`. The existing `setup` must:
- take `opts: { mode?; logoStatus?; brands?: Brand[] | null; config?: ReportConfig }`;
- start its harness state from `opts.config ?? reportConfig()`;
- return `latest: () => latest` next to whatever it returns today.

Edit the `setup` signature and return value accordingly; existing cases keep passing because every new option is optional.

Append inside `describe("ReportPreview", ...)` in `frontend/src/reports/ReportPreview.test.tsx`. Its `setup(props: Partial<ReportPreviewProps>)` spreads `props` onto the component, and its `io` and `section` helpers reveal a section, as the existing "puts the logo from the given asset resolver on the cover sheet" case does:

```tsx
  it("draws the cover in the brand it is given", async () => {
    const { container } = setup({
      brand: { gradient: ["#141D2D", "#141D2D", "#9E0000"], fontFamily: null, logoSrc: null },
    });
    act(() => io.show(section("cover")));
    await screen.findByText("North yard inspection");
    const band = container.querySelector("[data-cover-band]") as HTMLElement;
    expect(band.style.background).toContain("rgb(158, 0, 0)");
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm -C frontend exec vitest run src/reports/ReportSettings.test.tsx src/reports/ReportPreview.test.tsx`
Expected: FAIL, no element labelled "Brand", and the preview band is the Kestrel gradient.

- [ ] **Step 3: Add the picker**

In `frontend/src/reports/ReportSettings.tsx`:
- add `import type { Brand } from "@/api/brands";` and `Select` to the `@/ui` import;
- add to `ReportSettingsProps`:

```ts
  /** App-level brands (useBrands in ReportBuilder); null or absent while they load. */
  brands?: Brand[] | null;
```

- destructure `brands = null` in `ReportSettings`;
- insert this as the first child of `<Region title="Cover">`:

```tsx
        <Field
          label="Brand"
          htmlFor="report-brand"
          hint="Colours, fonts, logos and footer of the PDF. Brands are managed in App settings."
        >
          <Select
            id="report-brand"
            dense
            value={config.brand_id ?? ""}
            onChange={(e) => onEdit((c) => ({ ...c, brand_id: e.target.value || null }))}
          >
            <option value="">Kestrel theme</option>
            {(brands ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
            {brands && config.brand_id && !brands.some((b) => b.id === config.brand_id) ? (
              <option value={config.brand_id} disabled>
                Brand not found (Kestrel theme)
              </option>
            ) : null}
          </Select>
        </Field>
```

While brands load and the config names one, the select has no matching option, and the browser shows the first option ("Kestrel theme") until the list arrives. Nothing is written until the operator changes the select.

- [ ] **Step 4: Put the brand on the preview env**

In `frontend/src/reports/ReportPreview.tsx`:
- import `type CoverBrand` from `./preview/PreviewContext`;
- add to `ReportPreviewProps`:

```ts
  /** The report's brand for the cover (spec 2026-10-02-asset-findings §9); null is the Kestrel theme. */
  brand?: CoverBrand | null;
```

- destructure `brand = null`;
- add `brand` to the `env` object and to its `useMemo` dependency list.

- [ ] **Step 5: Resolve the brand in the builder**

In `frontend/src/reports/ReportBuilder.tsx`:
- add `import { useBrandLogoSrc, useBrands, type Brand } from "@/api/brands";` and `import { coverBrandOf } from "./preview/coverBrand";`;
- add near the other hooks, before the first early `return`:

```ts
  const brandList = useBrands();
  const brandLogo = useBrandLogoSrc();
  const coverOf = (brandId: string | null | undefined) => {
    const b: Brand | undefined = brandList.brands.find((x) => x.id === brandId);
    return b ? coverBrandOf(b, brandLogo(b, "on_dark")) : null;
  };
```

- pass `brand={coverOf(viewed.v.config.brand_id)}` to the version `ReportPreview`;
- pass `brand={coverOf(config.brand_id)}` to the draft `ReportPreview`;
- pass `brands={brandList.loading ? null : brandList.brands}` to `ReportSettings`.

- [ ] **Step 6: Run the report tests**

Run: `pnpm -C frontend exec vitest run src/reports`
Expected: PASS. If a `ReportBuilder.test.tsx` case fails because it counts requests or asserts that every request matched a route, add `{ method: "GET", path: /\/api\/v1\/brands$/, body: { items: [] } }` to that file's `routes()` helper. Do not change any assertion.

- [ ] **Step 7: Commit**

```
git add frontend/src/reports/ReportSettings.tsx frontend/src/reports/ReportSettings.test.tsx frontend/src/reports/ReportPreview.tsx frontend/src/reports/ReportPreview.test.tsx frontend/src/reports/ReportBuilder.tsx
git commit -m "reports: brand picker writes brand_id and the builder preview takes the brand (asset findings U6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add `frontend/src/reports/ReportBuilder.test.tsx` if Step 6 changed it.)

---

### Task 7: Playwright: the brand editor preview on Prism

**Files:**
- Create: `frontend/e2e/fixtures/brands.ts`
- Create: `frontend/e2e/brands.spec.ts`

**Interfaces:**
- Consumes: `fulfilJson` from `frontend/e2e/fixtures/appSections.ts`; the Prism mock, which `playwright.config.ts` starts. The brand routes are answered with `page.route` so the run is deterministic: Prism's generated examples are not brand-shaped data.

- [ ] **Step 1: Write the fixtures**

Create `frontend/e2e/fixtures/brands.ts`:

```ts
const T0 = "2026-10-03T00:00:00Z";

export const EAND = {
  id: "builtin-eand",
  name: "e&",
  colors: {
    accent: "#BC0000",
    accent_dark: "#9E0000",
    navy: "#141D2D",
    ink: "#1A1A1A",
    pale: "#FFE5E5",
    line: "#E7E4DE",
  },
  font_text: "Nunito Sans",
  font_numerals: "Poppins",
  logo_on_light: null,
  logo_on_dark: null,
  logo_flat: null,
  website: "www.eand.com",
  owner: "e&",
  confidentiality: "© {year} e&. All rights reserved.",
  pdf_author: "e& Drones, Robotics & AI",
  builtin: true,
  created_at: T0,
  updated_at: T0,
};

export const WHITE_LABEL = {
  ...EAND,
  id: "builtin-white-label",
  name: "White label",
  colors: {
    accent: "#1F4FD1",
    accent_dark: "#173DA6",
    navy: "#131A26",
    ink: "#141821",
    pale: "#E8EEFF",
    line: "#E3E6EC",
  },
  font_text: "Inter",
  font_numerals: "Inter",
  website: "",
  owner: "",
  confidentiality: "Confidential. Prepared for {customer}. Do not distribute without written consent.",
  pdf_author: "",
};
```

- [ ] **Step 2: Write the spec**

Create `frontend/e2e/brands.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { fulfilJson } from "./fixtures/appSections";
import { EAND, WHITE_LABEL } from "./fixtures/brands";

test("the brand editor previews a colour live, saves it, and creates then deletes a brand", async ({ page }) => {
  let brands: Array<Record<string, unknown>> = [EAND, WHITE_LABEL];
  await page.route(
    (url) => url.pathname === "/api/v1/brands",
    async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { name: string };
        const created = { ...WHITE_LABEL, id: "b-new", name: body.name, builtin: false, font_text: null, font_numerals: null };
        brands = [...brands, created];
        return fulfilJson(route, created, 201);
      }
      return fulfilJson(route, { items: brands });
    },
  );
  await page.route(
    (url) => /^\/api\/v1\/brands\/[^/]+$/.test(url.pathname),
    async (route) => {
      const id = new URL(route.request().url()).pathname.split("/").pop();
      if (route.request().method() === "DELETE") {
        brands = brands.filter((b) => b.id !== id);
        return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
      }
      const current = brands.find((b) => b.id === id) ?? EAND;
      const next = { ...current, ...(route.request().postDataJSON() as object), updated_at: "2026-10-03T01:00:00Z" };
      brands = brands.map((b) => (b.id === id ? next : b));
      return fulfilJson(route, next);
    },
  );

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Report brands" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("e&");

  const band = page.getByTestId("brand-cover-preview").locator("[data-cover-band]");
  await expect(band).toHaveAttribute("style", /rgb\(20, 29, 45\)|#141D2D/i);
  await page.getByLabel("Accent dark hex").fill("#00AA55");
  await expect(band).toHaveAttribute("style", /rgb\(0, 170, 85\)|#00AA55/i);

  const patch = page.waitForRequest((r) => r.method() === "PATCH");
  await page.getByRole("button", { name: "Save brand" }).click();
  expect((await patch).postDataJSON()).toEqual({ colors: { ...EAND.colors, accent_dark: "#00AA55" } });
  await expect(page.getByText("Saved")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete brand" })).toHaveCount(0);

  const post = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/v1/brands"));
  await page.getByRole("button", { name: "New brand" }).click();
  expect((await post).postDataJSON()).toEqual({ name: "New brand" });
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("New brand");

  await page.getByRole("button", { name: "Delete brand" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete New brand?" });
  const del = page.waitForRequest((r) => r.method() === "DELETE");
  await dialog.getByRole("button", { name: "Delete brand" }).click();
  expect((await del).url()).toMatch(/\/api\/v1\/brands\/b-new$/);
  await expect(page.getByRole("list", { name: "Brands" }).getByRole("button", { name: "New brand" })).toHaveCount(0);
});
```

- [ ] **Step 3: Run it**

Run (free ports, so another checkout's dev servers do not answer): `$env:E2E_WEB_PORT = 1520; $env:E2E_MOCK_PORT = 4110; pnpm -C frontend exec playwright test e2e/brands.spec.ts`
Expected: PASS. The first run builds `dist-e2e`, which takes about a minute.

- [ ] **Step 4: Commit**

```
git add frontend/e2e/fixtures/brands.ts frontend/e2e/brands.spec.ts
git commit -m "e2e: brand editor preview, save, create and delete on Prism (asset findings U6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Gate and merge

- [ ] **Step 1: Run the full gate**

From the worktree root:

```
pnpm -C contract check
cd backend; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

Expected: all pass. Run `pnpm -C frontend e2e` through `scripts\finish-task.ps1`. If that script fails on PS 5.1, set `E2E_WEB_PORT` and `E2E_MOCK_PORT` to free ports and run the command directly. The `cargo test` line runs only when the frozen sidecar exists.

- [ ] **Step 2: Merge** `task/af-u6` into `main`, re-run `pnpm -C frontend test` on `main`, remove the worktree (links as links, then `git worktree remove`), delete the branch.

- [ ] **Step 3: Operator walkthrough** (in the merge report)

1. Start the app (`scripts\dev.ps1`) and open **App settings** from the rail.
2. Scroll to **Report brands**. e& is selected; the preview band is navy with a dark red end.
3. Change **Accent dark** to `#00AA55`. The preview band turns green at its end as you type, and **Save brand** saves it. **Delete brand** is not offered for e&.
4. Under **Logos**, **Logo on dark**, choose `logo-on-dark.png` from the kit's `brands\eand\` folder. It appears on the navy chip and at the bottom left of the preview band.
5. Press **New brand**. "New brand" appears in the list. Delete it with **Delete brand** and confirm.
6. Open a project, then **Reports**, then a report. In the right pane under **Cover**, pick **Brand: e&**. The builder's cover takes the e& colours.

The PDF itself prints the brand once R1 lands.

---

## Self-review

**Spec coverage (U6's share):**
- §9 brand editor (Task 5). It edits:
  - the name;
  - the colours: six, each a swatch plus a hex field;
  - the fonts: text and numerals, from D2's bundled families;
  - the three logos (Task 4);
  - the text fields: website, owner, PDF author and the confidentiality line.
- The live cover preview reuses `CoverBlock` through the preview env (Tasks 2 and 5).
- List, create and delete; built-ins are never deleted (Task 5).
- `ReportConfig.brand_id` from the builder's picker (Task 6).
- `frontend/src/api/brands.ts` with `useBrands`, `createBrand`, `patchBrand` and `deleteBrand` (Task 1).
- Vitest on every module, and the Playwright "brand editor preview" e2e from §12 (Task 7).
- `ui` primitives only. Brand colours reach CSS through `style` values and `--c`, never class names (Tasks 4 and 5; `pnpm -C frontend lint` runs `check-tokens`).
- No em or en dashes in UI copy.

**Review Focus:** the index assigns no Review Focus test to U6.

**Placeholders:** none. Two steps adapt to existing test helpers whose bodies this plan does not restate (`ReportSettings.test.tsx` `setup`, `ReportPreview.test.tsx` `setup`); each step states the exact change.

## Index notes

1. **Brand picker owner.** The index's frontend table lists the picker in `reports/ReportSettings.tsx` as "R1's builder UI". The controller's brief for this phase assigns it to U6, and it is built here (Task 6). R1 does not need to touch `ReportSettings.tsx` for brands.
2. **More exports in `api/brands.ts`.** Beyond the index's `useBrands`, `createBrand`, `patchBrand` and `deleteBrand`, the module exports:
   - `fetchBrands`;
   - `setBrandLogo`, `clearBrandLogo`, `logoIdOf`, `brandLogoUrl`, `useBrandLogoSrc` (D2 adds the logo operations to the contract; see D2's Index notes);
   - `isBrandNameTaken`, `formatConfidentiality`;
   - `BRAND_FONTS`, `LOGO_SLOTS`.
3. **The cover preview shows the brand's `on_dark` logo at the band's bottom left**, with the report's own logo chip unchanged at the top right. R1 should place the brand logo the same way on the PDF cover so the preview stays honest; if R1 chooses another place, move the `data-brand-logo` image in `CoverBlock` to match.
4. **Brand fonts in the preview** are named in CSS but not loaded as web fonts. The webview draws them only if they are installed, and the caption says so. Loading the bundled TTFs into the webview would need a font-file route; it is out of scope here.
