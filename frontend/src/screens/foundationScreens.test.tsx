import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AboutScreen } from "./AboutScreen";
import { CloudsScreen } from "./CloudsScreen";

describe("the empty screens foundation F0 lands", () => {
  it("Point clouds says what it is for", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/pointclouds$/, body: { items: [] } }]);
    renderWithProviders(<CloudsScreen />, { api, route: "/p/p1/clouds", path: "/p/:projectId/clouds" });
    // The empty state replaces the loading layout once the list answers; wait for it first.
    expect(await screen.findByText("Import a LAS or LAZ point cloud")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Point clouds" })).toBeInTheDocument();
  });

  it("About names the app", () => {
    render(<AboutScreen />);
    expect(screen.getByRole("heading", { name: "About Kestrel AI" })).toBeInTheDocument();
  });
});
