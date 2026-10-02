import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRail } from "@/ui";
import { composeFeatures } from "./compose";
import type { CloudToolId } from "./tools";
import { useCloudRail } from "./useCloudRail";

afterEach(() => {
  localStorage.clear();
  window.innerWidth = 1024; // jsdom's default
});

let armTool: (id: CloudToolId) => void = () => {};

function Harness({
  available = () => true,
  onArm = vi.fn(),
  findingDetail = null,
  measureDetail = null,
}: {
  available?: (id: CloudToolId) => boolean;
  onArm?: (id: CloudToolId) => void;
  findingDetail?: ReactNode;
  measureDetail?: ReactNode;
}) {
  const [active, setActive] = useState<CloudToolId>("orbit");
  useEffect(() => {
    armTool = (id) => {
      onArm(id);
      setActive(id);
    };
  }, [onArm]);
  const features = composeFeatures([
    {
      name: "f",
      findings: {
        list: <p>pin list</p>,
        detail: findingDetail,
        count: 2,
        menu: [{ id: "m", label: "Do", onSelect() {} }],
      },
      measure: { list: <p>measure list</p>, detail: measureDetail, count: 0 },
    },
  ]);
  const rail = useCloudRail({
    active,
    arm: (id) => armTool(id),
    isAvailable: available,
    features,
    layersBody: <p>layers body</p>,
    clipBody: <p>clip help</p>,
    photosBody: <p>photos help</p>,
  });
  return (
    <>
      <WorkspaceRail
        label="Point cloud"
        store={rail.store}
        nav={rail.nav}
        topics={rail.topics}
        inspectorOpen={rail.detail !== null}
        bottomInset={120}
      />
      <output data-testid="detail">{rail.detail}</output>
    </>
  );
}

describe("useCloudRail", () => {
  it("puts Orbit, Pan and Fly on the rail, then the five topics, with Findings open", () => {
    render(<Harness />);
    const rail = screen.getByRole("toolbar", { name: "Point cloud" });
    expect(
      within(rail)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Orbit", "Pan", "Fly", "Layers", "Findings", "Measure", "Clip", "Photos"]);
    const findings = screen.getByRole("region", { name: "Findings" });
    expect(within(findings).getByRole("heading", { name: "Findings" })).toBeInTheDocument();
    expect(findings).toHaveTextContent("pin list");
    expect(within(findings).getByRole("button", { name: "Pin a finding" })).toBeEnabled();
    expect(within(findings).getByRole("button", { name: "Findings actions" })).toBeInTheDocument();
  });

  it("arming a tool switches the open panel to its topic; a navigation tool leaves it", async () => {
    render(<Harness />);
    act(() => armTool("distance"));
    expect(screen.getByRole("region", { name: "Measure" })).toHaveTextContent("measure list");
    act(() => armTool("pan"));
    expect(screen.getByRole("region", { name: "Measure" })).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("region", { name: "Measure" })).getByRole("button", { name: "Area" }),
    );
    expect(screen.getByRole("button", { name: "Area" })).toHaveAttribute("aria-pressed", "true");
  });

  it("disables Clipping box with its reason (and Fly) when the engine cannot clip", async () => {
    const onArm = vi.fn();
    render(<Harness available={(id) => id !== "clip" && id !== "fly"} onArm={onArm} />);
    await userEvent.click(
      within(screen.getByRole("toolbar", { name: "Point cloud" })).getByRole("button", { name: "Clip" }),
    );
    const clip = within(screen.getByRole("region", { name: "Clip" })).getByRole("button", {
      name: "Clipping box — This view cannot clip",
    });
    expect(clip).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fly" })).toBeDisabled();
    expect(screen.getByRole("region", { name: "Clip" })).toHaveTextContent("clip help");
  });

  it("the inspector shows the selection of the topic last opened, else whichever there is", async () => {
    window.innerWidth = 1600; // a wide window: the inspector does not close the panel
    const { rerender } = render(<Harness findingDetail={<p>finding F-0001</p>} />);
    expect(screen.getByTestId("detail")).toHaveTextContent("finding F-0001");
    // A finding and a measurement both selected: Findings is open, so the finding shows ...
    rerender(<Harness findingDetail={<p>finding F-0001</p>} measureDetail={<p>Area 1</p>} />);
    expect(screen.getByTestId("detail")).toHaveTextContent("finding F-0001");
    // ... and opening Measure shows the measurement.
    const rail = screen.getByRole("toolbar", { name: "Point cloud" });
    await userEvent.click(within(rail).getByRole("button", { name: "Measure" }));
    expect(screen.getByTestId("detail")).toHaveTextContent("Area 1");
    rerender(<Harness findingDetail={<p>finding F-0001</p>} />);
    expect(screen.getByTestId("detail")).toHaveTextContent("finding F-0001");
    rerender(<Harness />);
    expect(screen.getByTestId("detail")).toBeEmptyDOMElement();
  });
});
