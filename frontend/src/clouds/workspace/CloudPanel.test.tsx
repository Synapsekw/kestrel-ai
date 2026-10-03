import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PointCloud } from "@/api/clouds";
import type { ColourAvailability } from "@/clouds/viewer/types";
import { exampleCloud, CLOUD_ID } from "@/test/cloudFixtures";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { CloudPanel, RenderControls } from "./CloudPanel";
import { Readout } from "./Readout";
import type { RenderSettings } from "./types";

const INITIAL: RenderSettings = {
  colour: "rgb",
  elevationRange: [-44, 170],
  pointSize: 1,
  budget: 3_000_000,
  edl: true,
};

function Panel({
  cloud = exampleCloud,
  availability = { rgb: true, elevation: true, intensity: false, classification: true },
  onToggleClass = vi.fn(),
}: {
  cloud?: PointCloud;
  availability?: ColourAvailability | null;
  onToggleClass?: (code: number) => void;
}) {
  const [render, setRender] = useState(INITIAL);
  return (
    <CloudPanel
      projectId={PROJECT_ID}
      cloud={cloud}
      clouds={[cloud, { ...cloud, id: "c2", name: "Tower", status: "importing" }]}
      onImport={vi.fn()}
      onDetails={vi.fn()}
      onDeleted={vi.fn()}
    >
      <RenderControls
        cloud={cloud}
        render={render}
        onRender={setRender}
        availability={availability}
        hiddenClasses={new Set([6])}
        onToggleClass={onToggleClass}
        pointsShown={2_400_000}
      />
      <output data-testid="render">{JSON.stringify(render)}</output>
    </CloudPanel>
  );
}

const show = (ui: React.ReactElement) => renderWithProviders(ui, { api: fakeClient([]).api });
const render = () => JSON.parse(screen.getByTestId("render").textContent!) as RenderSettings;

describe("the cloud panel (spec §6)", () => {
  it("names the cloud and lists the project's clouds with import and details", async () => {
    const onImport = vi.fn();
    show(
      <CloudPanel
        projectId={PROJECT_ID}
        cloud={exampleCloud}
        clouds={[exampleCloud]}
        onImport={onImport}
        onDetails={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    const picker = screen.getByRole("button", { name: /^Point cloud: Chimney stack 3D/ });
    expect(picker).toHaveTextContent("21.7 M points");
    await userEvent.click(picker);
    expect(screen.getByRole("list", { name: "Point clouds" })).toHaveTextContent("ready");
    await userEvent.click(screen.getByRole("button", { name: "Import point cloud…" }));
    expect(onImport).toHaveBeenCalledOnce();
  });

  it("keeps its glass shell on its own, and drops it as the Layers topic's body (embedded)", () => {
    const { unmount } = show(
      <CloudPanel
        projectId={PROJECT_ID}
        cloud={exampleCloud}
        clouds={[exampleCloud]}
        onImport={vi.fn()}
        onDetails={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    expect(screen.getByRole("region", { name: "Point cloud" })).toBeInTheDocument();
    unmount();
    show(
      <CloudPanel
        embedded
        projectId={PROJECT_ID}
        cloud={exampleCloud}
        clouds={[exampleCloud]}
        onImport={vi.fn()}
        onDetails={vi.fn()}
        onDeleted={vi.fn()}
      >
        <p>render rows</p>
      </CloudPanel>,
    );
    expect(screen.queryByRole("region", { name: "Point cloud" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Point cloud: Chimney stack 3D/ })).toBeInTheDocument();
    expect(screen.getByText("render rows")).toBeInTheDocument();
  });

  it("offers the four colour modes and says which the cloud lacks", async () => {
    show(<Panel />);
    expect(screen.getByRole("radio", { name: "Intensity" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Class" })).toBeEnabled();
    expect(screen.getByText("This cloud has no intensity.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Elevation" }));
    expect(render().colour).toBe("elevation");
    expect(screen.getByLabelText("Lowest")).toHaveValue(-44);
    fireEvent.change(screen.getByLabelText("Highest"), { target: { value: "100" } });
    expect(render().elevationRange).toEqual([-44, 100]);
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(render().elevationRange).toEqual([-44, 170]);
  });

  it("toggles a class from its chip and shows hidden ones struck through", async () => {
    const onToggleClass = vi.fn();
    show(
      <Panel
        cloud={{ ...exampleCloud, class_counts: { "2": 900, "6": 120 } }}
        onToggleClass={onToggleClass}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Class" }));
    const classes = screen.getByRole("list", { name: "Classes" });
    expect(classes).toHaveTextContent("Ground");
    expect(screen.getByRole("button", { name: /Building/ })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: /Ground/ }));
    expect(onToggleClass).toHaveBeenCalledWith(2);
  });

  it("sets the budget on its stops, shows the points drawn, and switches EDL", async () => {
    show(<Panel />);
    expect(screen.getByTestId("cloud-points-shown")).toHaveTextContent("2.4 M shown");
    const budget = screen.getByRole("slider", { name: "Point budget" });
    budget.focus();
    await userEvent.keyboard("{End}");
    expect(render().budget).toBe(8_000_000);
    await userEvent.click(screen.getByRole("switch", { name: "EDL shading" }));
    expect(render().edl).toBe(false);
  });

  it("reads out a pick with its spacing and CRS, and a dash with none", () => {
    const { rerender } = show(<Readout cloud={exampleCloud} pick={null} />);
    const ro = screen.getByTestId("cloud-readout");
    expect(ro).toHaveTextContent("E—");
    expect(ro).toHaveTextContent("EPSG:32639 · m");
    rerender(
      <Readout
        cloud={exampleCloud}
        pick={{ x: 243500.126, y: 3178000.5, z: 12.5, level: 3, uncertainty_m: 0.25 }}
      />,
    );
    // rerender drops the providers, so the tree remounts: query the readout again.
    expect(screen.getByTestId("cloud-readout")).toHaveTextContent("E243500.13");
    expect(screen.getByText("25.0 cm")).toHaveClass("text-warn");
  });

  it("asks before deleting a listed cloud, and the trash does not open that cloud", async () => {
    const onDeleted = vi.fn();
    const { api, requests } = fakeClient([
      { method: "DELETE", path: new RegExp(`/pointclouds/c2$`), status: 204 },
    ]);
    renderWithProviders(
      <>
        <CloudPanel
          projectId={PROJECT_ID}
          cloud={exampleCloud}
          clouds={[exampleCloud, { ...exampleCloud, id: "c2", name: "Tower", status: "importing" }]}
          onImport={vi.fn()}
          onDetails={vi.fn()}
          onDeleted={onDeleted}
        />
        <LocationProbe />
      </>,
      { api, route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}` },
    );
    await userEvent.click(screen.getByRole("button", { name: /^Point cloud:/ }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Tower" }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/clouds/${CLOUD_ID}`);
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    const dialog = screen.getByRole("dialog", { name: "Are you sure?" });
    expect(dialog).toHaveTextContent("The 3D view copy and the measurements go");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onDeleted).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /^Point cloud:/ }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Tower" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("c2"));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/clouds/${CLOUD_ID}`);
  });
});
