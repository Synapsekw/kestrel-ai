import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("names the coordinates and the approximate area in the drawing's label", () => {
    render(<SiteLocation site={exampleSite} pins={[]} />);
    expect(
      screen.getByRole("img", { name: "Site location, 44.8125° N 20.4612° E, about 24.1 ha" }),
    ).toBeInTheDocument();
  });

  it("draws the scale label inside the drawing, beside its bar, so letterboxing cannot part them", () => {
    render(<SiteLocation site={exampleSite} pins={[]} />);
    const svg = screen.getByRole("img", { name: /site location/i });
    const label = svg.querySelector("text[data-testid='scale-label']");
    expect(label?.textContent).toMatch(/^\d+ (m|km)$/);
    expect(label?.parentElement).toBe(svg.querySelector("[data-testid='scale-bar']")?.parentElement);
  });

  describe("basemap (spec 2026-10-02-site-basemap)", () => {
    const url = (source: string) => `http://b/api/v1/basemap/${source}/{z}/{x}/{y}?token=t`;
    beforeEach(() => localStorage.clear());

    it("lays satellite tiles under the drawing, with their attribution", () => {
      render(<SiteLocation site={exampleSite} pins={[]} basemapUrl={url} />);
      const tiles = screen.getAllByTestId("basemap-tile");
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.length).toBeLessThanOrEqual(9);
      expect(tiles[0].getAttribute("href")).toMatch(
        /^http:\/\/b\/api\/v1\/basemap\/satellite\/\d+\/\d+\/\d+\?token=t$/,
      );
      const svg = screen.getByRole("img", { name: /site location/i });
      // Underneath: the basemap group comes before the outline in paint order.
      expect(svg.querySelector("[data-testid='basemap']")?.nextElementSibling).toBe(
        svg.querySelector("[data-testid='site-outline']"),
      );
      expect(screen.getByText(/© Esri/)).toBeInTheDocument();
    });

    it("switches to the street map and remembers the choice", async () => {
      render(<SiteLocation site={exampleSite} pins={[]} basemapUrl={url} />);
      await userEvent.click(screen.getByRole("radio", { name: "Map" }));
      expect(screen.getAllByTestId("basemap-tile")[0].getAttribute("href")).toContain("/streets/");
      expect(screen.getByText(/© OpenStreetMap contributors/)).toBeInTheDocument();
      cleanup();
      render(<SiteLocation site={exampleSite} pins={[]} basemapUrl={url} />);
      expect(screen.getAllByTestId("basemap-tile")[0].getAttribute("href")).toContain("/streets/");
    });

    it("hides a tile that fails, and the attribution once none is left (offline)", () => {
      render(<SiteLocation site={exampleSite} pins={[]} basemapUrl={url} />);
      const tiles = screen.getAllByTestId("basemap-tile");
      fireEvent.error(tiles[0]);
      expect(screen.getAllByTestId("basemap-tile")).toHaveLength(tiles.length - 1);
      for (const t of screen.getAllByTestId("basemap-tile")) fireEvent.error(t);
      expect(screen.queryByTestId("basemap-tile")).toBeNull();
      expect(screen.queryByText(/© Esri/)).toBeNull();
      expect(screen.getByTestId("site-outline")).toBeInTheDocument();
    });

    it("draws no basemap and no switch without a tile source", () => {
      render(<SiteLocation site={exampleSite} pins={[]} />);
      expect(screen.queryByTestId("basemap")).toBeNull();
      expect(screen.queryByRole("radiogroup")).toBeNull();
    });
  });

  it("draws the photo points strongly enough to read at site scale", () => {
    render(<SiteLocation site={exampleSite} pins={[]} />);
    const [p] = screen.getAllByTestId("photo-point");
    expect(Number(p.getAttribute("opacity"))).toBeGreaterThanOrEqual(0.85);
  });
});
