import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LayerRow } from "@/site3d/layerRows";
import { LayersPanel, type LayersPanelProps } from "./LayersPanel";

const ROWS: LayerRow[] = [
  {
    id: "model",
    label: "Plant model",
    group: "Model",
    visible: true,
    opacity: 1,
    status: { kind: "ready" },
  },
  {
    id: "ortho:o1",
    label: "May ortho",
    group: "Imagery",
    visible: true,
    opacity: 0.5,
    status: { kind: "ready" },
  },
  {
    id: "ortho:o2",
    label: "April ortho",
    group: "Imagery",
    visible: true,
    opacity: 1,
    status: { kind: "unavailable", reason: "This map was removed." },
  },
  {
    id: "cloud:c1",
    label: "Local scan",
    group: "Point clouds",
    visible: true,
    opacity: null,
    status: {
      kind: "unavailable",
      reason: "Can't place this cloud: it is in a different coordinate system from the site.",
    },
  },
  {
    id: "cloud:c2",
    label: "May survey",
    group: "Point clouds",
    visible: true,
    opacity: null,
    status: { kind: "error", message: "The cloud could not load: HTTP 404" },
  },
  {
    id: "water",
    label: "Water",
    group: "Environment",
    visible: true,
    opacity: null,
    status: { kind: "ready" },
  },
  {
    id: "sky",
    label: "Sky",
    group: "Environment",
    visible: true,
    opacity: null,
    status: { kind: "ready" },
  },
  {
    id: "photos",
    label: "Photos",
    group: "Data",
    visible: false,
    opacity: null,
    status: { kind: "ready" },
  },
];
function setup(over: Partial<LayersPanelProps> = {}) {
  const props: LayersPanelProps = {
    rows: ROWS,
    onVisible: vi.fn(),
    onOpacity: vi.fn(),
    colourBy: "material",
    onColourBy: vi.fn(),
    cloudColour: "rgb",
    onCloudColour: vi.fn(),
    budget: 3_000_000,
    onBudget: vi.fn(),
    ...over,
  };
  render(<LayersPanel {...props} />);
  return props;
}

describe("LayersPanel", () => {
  it("lists the layers by group, each with a switch", () => {
    setup();
    const panel = screen.getByRole("region", { name: "Layers" });
    expect(
      within(panel)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(["Model", "Imagery", "Point clouds", "Environment", "Data"]);
    expect(within(panel).getByRole("switch", { name: "Sky" })).toHaveAttribute("aria-checked", "true");
    expect(within(panel).getByRole("switch", { name: "Photos" })).toHaveAttribute("aria-checked", "false");
  });

  it("a switch toggles its layer", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("switch", { name: "Sky" }));
    expect(p.onVisible).toHaveBeenCalledWith("sky", false);
  });

  it("a layer that can't show is off, disabled and says why; an error reads as an error", () => {
    setup();
    const local = screen.getByRole("switch", { name: "Local scan" });
    expect(local).toBeDisabled();
    expect(local).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/^Can't place this cloud/)).toBeInTheDocument();
    expect(screen.getByText("The cloud could not load: HTTP 404")).toHaveClass("text-danger");
  });

  it("a removed map is greyed, disabled and says so, with no opacity slider", () => {
    setup();
    const gone = screen.getByRole("switch", { name: "April ortho" });
    expect(gone).toBeDisabled();
    expect(gone).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("This map was removed.")).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "April ortho opacity" })).toBeNull();
  });

  it("opacity sliders show for shown layers that have opacity, and move in 5 % steps", () => {
    const p = setup();
    const slider = screen.getByRole("slider", { name: "May ortho opacity" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(p.onOpacity).toHaveBeenCalledWith("ortho:o1", 0.55);
    expect(screen.queryByRole("slider", { name: "Photos opacity" })).toBeNull();
  });

  it("colours the model by a register field, the clouds by colour or height, and sets the point budget", () => {
    const p = setup();
    fireEvent.change(screen.getByLabelText("Colour the model by"), { target: { value: "height_source" } });
    expect(p.onColourBy).toHaveBeenCalledWith("height_source");
    fireEvent.click(screen.getByRole("radio", { name: "Height" }));
    expect(p.onCloudColour).toHaveBeenCalledWith("elevation");
    fireEvent.change(screen.getByLabelText("Point budget"), { target: { value: "5000000" } });
    expect(p.onBudget).toHaveBeenCalledWith(5_000_000);
  });

  it("folds away", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Hide layers" }));
    expect(screen.queryByRole("switch", { name: "Sky" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show layers" })).toHaveAttribute("aria-expanded", "false");
  });
});
