import { describe, expect, it } from "vitest";
import type { Surface } from "@contract/client";
import { exampleBaseSurface, exampleMeasurement, exampleSurface } from "@/test/volumeFixtures";
import { baseCards, longDate, selectedCard } from "./baseCardsModel";

const design: Surface = {
  ...exampleSurface,
  id: "design-1",
  name: "Site plan rev C",
  kind: "design",
  captured_on: null,
  point_cloud_id: null,
};
const design2: Surface = { ...design, id: "design-2", name: "Pit rev D" };
const earlierDem: Surface = {
  ...exampleSurface,
  id: "dem-aug",
  name: "Aug DSM",
  kind: "dem",
  elevation_role: "dsm",
  captured_on: "2026-03-20",
};
const localOnly: Surface = {
  ...exampleBaseSurface,
  id: "local",
  crs_wkt: null,
  epsg: null,
};
const byId = (cards: ReturnType<typeof baseCards>, id: string) => cards.find((c) => c.id === id)!;

describe("baseCards", () => {
  it("offers the four cards in the mockup order", () => {
    const cards = baseCards({
      measurement: exampleMeasurement,
      top: exampleSurface,
      surfaces: [exampleSurface],
      l: null,
    });
    expect(cards.map((c) => [c.id, c.title])).toEqual([
      ["lowest", "Lowest point"],
      ["plane", "Best-fit plane"],
      ["design", "Design DTM"],
      ["earlier", "Earlier survey"],
    ]);
    expect(byId(cards, "lowest")).toMatchObject({
      sub: "flat at toe min",
      base: { kind: "toe_lowest" },
      disabledReason: null,
    });
    expect(byId(cards, "plane")).toMatchObject({
      sub: "through toe vertices",
      selected: true,
    });
  });

  it("disables design and earlier with the reason when no surface exists", () => {
    const cards = baseCards({
      measurement: exampleMeasurement,
      top: exampleSurface,
      surfaces: [exampleSurface],
      l: null,
    });
    expect(byId(cards, "design")).toMatchObject({
      base: null,
      disabledReason: "No design surface — import one from Add data",
    });
    expect(byId(cards, "earlier")).toMatchObject({
      base: null,
      disabledReason: "No earlier survey with a DSM",
    });
  });

  it("never pairs a local grid with a georeferenced top", () => {
    const cards = baseCards({
      measurement: exampleMeasurement,
      top: exampleSurface,
      surfaces: [exampleSurface, localOnly],
      l: null,
    });
    expect(byId(cards, "earlier").disabledReason).toBe("No earlier survey with a DSM");
  });

  it("picks the l-date DSM for the earlier card, else the newest before the top", () => {
    const surfaces = [exampleSurface, exampleBaseSurface, earlierDem];
    const withL = baseCards({
      measurement: exampleMeasurement,
      top: exampleSurface,
      surfaces,
      l: "2026-03-01",
    });
    expect(byId(withL, "earlier")).toMatchObject({
      sub: "DSM 1 Mar 2026",
      base: { kind: "surface", surface_id: exampleBaseSurface.id },
    });
    const noL = baseCards({
      measurement: exampleMeasurement,
      top: exampleSurface,
      surfaces,
      l: null,
    });
    expect(byId(noL, "earlier")).toMatchObject({
      sub: "DSM 20 Mar 2026",
      base: { kind: "surface", surface_id: "dem-aug" },
    });
  });

  it("says why the earlier card is off when the top has no date and no l is chosen", () => {
    const top = { ...exampleSurface, captured_on: null };
    const cards = baseCards({
      measurement: exampleMeasurement,
      top,
      surfaces: [top, exampleBaseSurface],
      l: null,
    });
    expect(byId(cards, "earlier").disabledReason).toBe("The top surface has no survey date");
  });

  it("offers a choice when there are several designs and selects the stored one", () => {
    const m = {
      ...exampleMeasurement,
      base: { kind: "surface" as const, surface_id: "design-2", z: null },
    };
    const cards = baseCards({
      measurement: m,
      top: exampleSurface,
      surfaces: [exampleSurface, design, design2],
      l: null,
    });
    const d = byId(cards, "design");
    expect(d.options.map((o) => o.label)).toEqual(["Pit rev D", "Site plan rev C"]);
    expect(d).toMatchObject({
      selected: true,
      sub: "Pit rev D",
      base: { kind: "surface", surface_id: "design-2" },
    });
    expect(selectedCard(cards)).toBe("design");
  });

  it("selects no card for the More bases kinds", () => {
    const m = {
      ...exampleMeasurement,
      base: { kind: "flat" as const, z: 12, surface_id: null },
    };
    expect(
      selectedCard(
        baseCards({
          measurement: m,
          top: exampleSurface,
          surfaces: [exampleSurface],
          l: null,
        }),
      ),
    ).toBeNull();
  });

  it("formats survey dates like the timeline", () => {
    expect(longDate("2026-09-14")).toBe("14 Sep 2026");
    expect(longDate(null)).toBe("date not set");
  });
});
