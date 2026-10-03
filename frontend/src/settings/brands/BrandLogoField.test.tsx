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

  it("shows a message instead of a broken image when the logo cannot load", () => {
    setup(partnerBrand, "tauri");
    fireEvent.error(screen.getByRole("img", { name: "Logo on dark" }));
    expect(screen.queryByRole("img", { name: "Logo on dark" })).not.toBeInTheDocument();
    expect(screen.getByText("Logo could not be loaded.")).toBeInTheDocument();
  });
});
