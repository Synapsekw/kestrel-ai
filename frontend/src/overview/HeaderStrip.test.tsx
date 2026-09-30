import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { exampleSite, noSite } from "@/test/findingFixtures";
import { renderWithProviders } from "@/test/render";
import { HeaderStrip } from "./HeaderStrip";

const figures = [{ id: "open" as const, label: "Open findings", value: 7 }];

describe("HeaderStrip", () => {
  it("shows the name, coordinates with their source, and the figures", () => {
    renderWithProviders(
      <HeaderStrip projectId={PROJECT_ID} name="Block C" figures={figures} site={exampleSite} />,
      { api: fakeClient([]).api },
    );
    expect(screen.getByRole("heading", { name: "Block C" })).toBeInTheDocument();
    expect(screen.getByText(/44\.8125° N 20\.4612° E/)).toBeInTheDocument();
    expect(screen.getByText(/from ortho/)).toBeInTheDocument();
    expect(screen.getByText("Open findings")).toBeInTheDocument();
  });

  it("keeps the name slot while the name loads, without a placeholder name", () => {
    renderWithProviders(<HeaderStrip projectId={PROJECT_ID} name={null} figures={[]} site={null} />, {
      api: fakeClient([]).api,
    });
    expect(screen.getByRole("heading", { name: "Loading project name" })).toBeInTheDocument();
    expect(screen.queryByText("Project")).not.toBeInTheDocument();
  });

  it("says once, quietly, when there is no location", () => {
    renderWithProviders(<HeaderStrip projectId={PROJECT_ID} name="Block C" figures={[]} site={noSite} />, {
      api: fakeClient([]).api,
    });
    expect(screen.getByText("No location data")).toBeInTheDocument();
  });

  it("names the photos as the source", () => {
    const site = { ...exampleSite, source: "images" as const };
    renderWithProviders(<HeaderStrip projectId={PROJECT_ID} name="Block C" figures={[]} site={site} />, {
      api: fakeClient([]).api,
    });
    expect(screen.getByText(/from ~1,280 photos/)).toBeInTheDocument();
  });

  it("shows no dangling separator when the source is unknown", () => {
    const site = { ...exampleSite, source: null };
    renderWithProviders(<HeaderStrip projectId={PROJECT_ID} name="Block C" figures={[]} site={site} />, {
      api: fakeClient([]).api,
    });
    expect(screen.getByText(/44\.8125° N 20\.4612° E/)).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it("shows the images figure as a bare number under its label, without a repeated unit", () => {
    const data = { id: "data" as const, label: "Project data", value: 1284, unit: "images" };
    renderWithProviders(<HeaderStrip projectId={PROJECT_ID} name="Block C" figures={[data]} site={null} />, {
      api: fakeClient([]).api,
    });
    expect(screen.getByText("Images")).toBeInTheDocument();
    expect(screen.queryByText("images")).not.toBeInTheDocument();
    expect(screen.getByText("1,284")).toBeInTheDocument();
  });
});
