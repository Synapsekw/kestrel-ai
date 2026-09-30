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
});
