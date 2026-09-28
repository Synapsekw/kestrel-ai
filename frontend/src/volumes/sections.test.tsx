import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { exampleGeoMap, exampleMapRun, exampleProject, fakeClient } from "@/test/fixtures";
import { PROJECT_ID, exampleMeasurement, exampleSurface, otherFlightRun } from "@/test/volumeFixtures";
import { renderWithProviders } from "@/test/render";
import { AlignmentSection } from "./AlignmentSection";
import { MasksSection } from "./MasksSection";
import { MeasurePanel } from "./MeasurePanel";

const routes = [
  { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  { method: "GET", path: /\/maps$/, body: { items: [exampleGeoMap] } },
  {
    method: "GET",
    path: /\/maps\/[^/]+\/runs$/,
    body: { items: [exampleMapRun, otherFlightRun] },
  },
];

describe("MasksSection", () => {
  it("lists runs by flight and saves a ticked run", async () => {
    const { api } = fakeClient(routes);
    const onSave = vi.fn();
    renderWithProviders(
      <MasksSection
        projectId={PROJECT_ID}
        measurement={exampleMeasurement}
        top={exampleSurface}
        baseSurface={null}
        onSave={onSave}
      />,
      { api },
    );
    expect(await screen.findByText("Same flight as top")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onSave).toHaveBeenCalledWith({
      masks: { detection_run_ids: [exampleMapRun.id] },
    });
  });
});

describe("AlignmentSection", () => {
  it("uses the given draw hint when no stable area is drawn", () => {
    renderWithProviders(
      <AlignmentSection measurement={exampleMeasurement} onSave={() => {}} drawHint="Draw it on the map." />,
      { api: fakeClient([]).api },
    );
    expect(screen.getByText("Draw it on the map.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Correct vertical shift" })).toBeDisabled();
  });
});

describe("MeasurePanel's base select", () => {
  it("shows a measurement's toe_lowest base as a disabled option (M-C0/M-B5 hand-off)", () => {
    const { api } = fakeClient(routes);
    renderWithProviders(
      <MeasurePanel
        projectId={PROJECT_ID}
        measurement={{ ...exampleMeasurement, base: { kind: "toe_lowest", z: null, surface_id: null } }}
        top={exampleSurface}
        surfaces={[exampleSurface]}
        picking={false}
        onPick={() => {}}
        onSave={() => {}}
        onChanged={() => {}}
      />,
      { api },
    );
    const select = screen.getByLabelText("Base") as HTMLSelectElement;
    expect(select.value).toBe("toe_lowest");
    const option = screen.getByRole("option", {
      name: "Stockpile toe — lowest point",
    }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(option.selected).toBe(true);
  });
});
