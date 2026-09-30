import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { exampleFinding, exampleSite, noSite } from "@/test/findingFixtures";
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

  it("colours a known-severity pin via --c and falls back to a token when severity is null", () => {
    const known = { ...exampleFinding, id: "f-k", severity: 3, lon: 20.4612, lat: 44.8125 };
    const none = { ...exampleFinding, id: "f-n", severity: null, lon: 20.4615, lat: 44.8127 };
    render(<SiteLocation site={exampleSite} pins={[known, none]} />);
    const [a, b] = screen.getAllByTestId("site-pin");
    expect(a.style.getPropertyValue("--c")).not.toBe("");
    expect(a).toHaveClass("fill-[color:var(--c)]");
    expect(b.style.getPropertyValue("--c")).toBe("");
    expect(b).toHaveClass("fill-muted");
    expect(b).not.toHaveClass("fill-[color:var(--c)]");
  });

  it("renders nothing without site geometry", () => {
    const { container } = render(<SiteLocation site={noSite} pins={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
