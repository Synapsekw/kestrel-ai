import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { exampleProviders, fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AppSettingsScreen } from "./AppSettingsScreen";

describe("AppSettingsScreen", () => {
  it("shows the provider keys without any project", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
    ]);
    renderWithProviders(<AppSettingsScreen />, { api, route: "/settings", path: "/settings" });
    expect(screen.getByRole("heading", { name: "App settings" })).toBeInTheDocument();
    expect(await screen.findByTestId("provider-anthropic")).toBeInTheDocument();
    expect(screen.getByText(/shared by every project/)).toBeInTheDocument();
    expect(requests.every((r) => !r.url.includes("/projects/"))).toBe(true);
  });

  it("links to About Kestrel AI", () => {
    const { api } = fakeClient([{ method: "GET", path: /\/providers$/, body: { items: exampleProviders } }]);
    renderWithProviders(<AppSettingsScreen />, { api, route: "/settings", path: "/settings" });
    expect(screen.getByRole("link", { name: "About Kestrel AI" })).toHaveAttribute("href", "/about");
  });
});
