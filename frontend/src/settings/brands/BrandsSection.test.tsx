import { describe, expect, it } from "vitest";
import { createApiClient } from "@contract/client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { errorBody, fakeClient, fakeFetch, type FakeRoute } from "@/test/fixtures";
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
    expect(
      within(list)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["e&Built in", "White labelBuilt in", "Orbit Aerials"]);
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
        body: (req) => ({
          ...eandBrand,
          ...(req.body as Partial<Brand>),
          updated_at: "2026-10-03T01:00:00Z",
        }),
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

  it("locks the editor while a save is in flight, so edits are not lost", async () => {
    const { fetch: inner } = fakeFetch([
      { method: "GET", path: /\/api\/v1\/brands$/, body: { items: exampleBrands } },
      { method: "PATCH", path: /\/brands\/[^/]+$/, body: { ...eandBrand, owner: "Acme" } },
    ]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const gated = (async (input: Request | string | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      if (req.method === "PATCH") await gate;
      return inner(input, init);
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: gated });
    renderWithProviders(<BrandsSection />, { api });
    fireEvent.change(await screen.findByLabelText("Owner"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Save brand" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeDisabled());
    release();
    await screen.findByText("Saved");
    expect(screen.getByLabelText("Name")).toBeEnabled();
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
    expect(
      within(dialog).getByText("Reports that use it will print with the Kestrel theme."),
    ).toBeInTheDocument();
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

  it("explains that Poppins body text prints in SemiBold", async () => {
    setup();
    await screen.findByLabelText("Name");
    const hint = "Poppins is bundled in SemiBold and Bold only, so body text prints in SemiBold.";
    expect(screen.queryByText(hint)).toBeNull();
    fireEvent.change(screen.getByLabelText("Text font"), { target: { value: "Poppins" } });
    expect(screen.getByText(hint)).toBeInTheDocument();
  });
});
