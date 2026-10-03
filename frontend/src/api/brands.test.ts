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
