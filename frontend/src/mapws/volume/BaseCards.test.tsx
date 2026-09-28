import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Surface } from "@contract/client";
import { exampleMeasurement, exampleSurface } from "@/test/volumeFixtures";
import { baseCards } from "./baseCardsModel";
import { BaseCards } from "./BaseCards";

const design: Surface = {
  ...exampleSurface,
  id: "design-1",
  name: "Site plan rev C",
  kind: "design",
  captured_on: null,
};
const design2: Surface = { ...design, id: "design-2", name: "Pit rev D" };

function setup(surfaces: Surface[], busy = false, m = exampleMeasurement) {
  const onBase = vi.fn();
  const cards = baseCards({
    measurement: m,
    top: exampleSurface,
    surfaces,
    l: null,
  });
  render(<BaseCards cards={cards} busy={busy} measurement={m} onBase={onBase} />);
  return onBase;
}
const flat = (z: number) => ({
  ...exampleMeasurement,
  base: { kind: "flat" as const, z, surface_id: null },
});

describe("BaseCards", () => {
  it("saves the clicked card's base", () => {
    const onBase = setup([exampleSurface]);
    fireEvent.click(screen.getByRole("radio", { name: "Lowest point" }));
    expect(onBase).toHaveBeenCalledWith({ kind: "toe_lowest" });
    expect(screen.getByTestId("base-card-plane")).toHaveAttribute("aria-checked", "true");
  });

  it("shows the reason on a disabled card and sends nothing", () => {
    const onBase = setup([exampleSurface]);
    const card = screen.getByTestId("base-card-design");
    expect(card).toBeDisabled();
    expect(card).toHaveTextContent("No design surface — import one from Add data");
    fireEvent.click(card);
    expect(onBase).not.toHaveBeenCalled();
  });

  it("disables every card while calculating", () => {
    const onBase = setup([exampleSurface], true);
    for (const id of ["lowest", "plane", "design", "earlier"])
      expect(screen.getByTestId(`base-card-${id}`)).toBeDisabled();
    fireEvent.click(screen.getByTestId("base-card-lowest"));
    expect(onBase).not.toHaveBeenCalled();
  });

  it("switches between several designs", () => {
    const m = {
      ...exampleMeasurement,
      base: { kind: "surface" as const, surface_id: "design-1", z: null },
    };
    const onBase = setup([exampleSurface, design, design2], false, m);
    fireEvent.change(screen.getByLabelText("Design surface"), {
      target: { value: "design-2" },
    });
    expect(onBase).toHaveBeenCalledWith({
      kind: "surface",
      surface_id: "design-2",
    });
  });

  it("offers the fitted-surface and flat bases under More bases", () => {
    const onBase = setup([exampleSurface]);
    fireEvent.click(screen.getByRole("button", { name: /More bases/ }));
    fireEvent.click(screen.getByRole("radio", { name: /fitted surface/ }));
    expect(onBase).toHaveBeenCalledWith({ kind: "toe_surface" });
    fireEvent.click(screen.getByRole("radio", { name: /Flat level/ }));
    expect(onBase).toHaveBeenLastCalledWith({ kind: "flat", z: null });
  });

  it("shows the stored base's name when no card is that surface", () => {
    const cards = baseCards({
      measurement: exampleMeasurement,
      top: exampleSurface,
      surfaces: [exampleSurface],
      l: null,
    });
    render(
      <BaseCards
        cards={cards}
        busy={false}
        measurement={exampleMeasurement}
        otherBase="Base: March survey · 1 Mar 2026"
        onBase={vi.fn()}
      />,
    );
    expect(screen.getByTestId("base-other")).toHaveTextContent("Base: March survey · 1 Mar 2026");
  });

  it("re-seeds the flat level when the stored level changes", () => {
    const cards = baseCards({
      measurement: flat(12),
      top: exampleSurface,
      surfaces: [exampleSurface],
      l: null,
    });
    const view = render(<BaseCards cards={cards} busy={false} measurement={flat(12)} onBase={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /More bases/ }));
    expect(screen.getByLabelText(/Level/)).toHaveValue(12);
    view.rerender(<BaseCards cards={cards} busy={false} measurement={flat(15)} onBase={vi.fn()} />);
    expect(screen.getByLabelText(/Level/)).toHaveValue(15);
  });
});
