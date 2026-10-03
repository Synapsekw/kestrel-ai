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
