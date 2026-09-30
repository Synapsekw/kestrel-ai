import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { exampleFinding, exampleSite } from "@/test/findingFixtures";
import { SiteLocation } from "./SiteLocation";

describe("SiteLocation", () => {
  it("draws the site outline, the photo points and the pins that have a location", () => {
    const located = { ...exampleFinding, id: "f-loc", lon: 20.4612, lat: 44.8125 };
    const unlocated = { ...exampleFinding, id: "f-none", lon: null, lat: null };
    render(<SiteLocation site={exampleSite} pins={[located, unlocated]} />);
    expect(screen.getByRole("img", { name: /site location/i })).toBeInTheDocument();
    expect(screen.getByTestId("site-outline")).toBeInTheDocument();
    expect(screen.getAllByTestId("photo-point")).toHaveLength(3);
    expect(screen.getAllByTestId("site-pin")).toHaveLength(1);
    expect(screen.getByText(/≈ 24\.1 ha/)).toBeInTheDocument();
  });
});
