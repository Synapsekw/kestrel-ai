import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RAIL_STORAGE_PREFIX, WorkspaceRail } from "@/ui";
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
  finding = null,
  measurement = null,
}: {
  available?: (id: CloudToolId) => boolean;
  onArm?: (id: CloudToolId) => void;
  /** The selected finding's id (its detail reads "finding <id>"). */
  finding?: string | null;
  /** The selected measurement's id (its detail reads "measurement <id>"). */
  measurement?: string | null;
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
        detail: finding ? <p>finding {finding}</p> : null,
        selectionKey: finding,
        count: 2,
        menu: [{ id: "m", label: "Do", onSelect() {} }],
      },
      measure: {
        list: <p>measure list</p>,
        detail: measurement ? <p>measurement {measurement}</p> : null,
        selectionKey: measurement,
        count: 0,
      },
    },
  ]);
  const rail = useCloudRail({
    active,
    arm: (id) => armTool(id),
    isAvailable: available,
    ready: true,
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

  it("hides the Clip topic when the engine cannot clip; Fly is disabled", () => {
    render(<Harness available={(id) => id !== "clip" && id !== "fly"} />);
    const rail = screen.getByRole("toolbar", { name: "Point cloud" });
    expect(within(rail).queryByRole("button", { name: "Clip" })).toBeNull();
    expect(
      within(rail)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Orbit", "Pan", "Fly", "Layers", "Findings", "Measure", "Photos"]);
    expect(within(rail).getByRole("button", { name: "Fly" })).toBeDisabled();
  });

  it("a remembered Clip topic falls back to Findings when the engine cannot clip", () => {
    localStorage.setItem(`${RAIL_STORAGE_PREFIX}clouds`, JSON.stringify({ open: true, topic: "clip" }));
    render(<Harness available={(id) => id !== "clip" && id !== "fly"} />);
    expect(screen.getByRole("region", { name: "Findings" })).toHaveTextContent("pin list");
  });

  it("with clip available, a remembered Clip topic opens it", () => {
    localStorage.setItem(`${RAIL_STORAGE_PREFIX}clouds`, JSON.stringify({ open: true, topic: "clip" }));
    render(<Harness />);
    expect(screen.getByRole("region", { name: "Clip" })).toHaveTextContent("clip help");
  });

  // Ruling R10: the inspector shows the most recent selection, whatever the rail shows. At 1024 px
  // (narrow) the inspector closes the panel, so the rail's topic cannot be what decides.
  it("the inspector shows the most recently selected item: a measurement, then a finding", () => {
    const { rerender } = render(<Harness measurement="m-1" />);
    expect(screen.getByTestId("detail")).toHaveTextContent("measurement m-1");
    rerender(<Harness measurement="m-1" finding="F-0001" />);
    expect(screen.getByTestId("detail")).toHaveTextContent("finding F-0001");
    // another measurement while the finding stays selected
    rerender(<Harness measurement="m-2" finding="F-0001" />);
    expect(screen.getByTestId("detail")).toHaveTextContent("measurement m-2");
    // the measurement deselected: the finding is still selected
    rerender(<Harness finding="F-0001" />);
    expect(screen.getByTestId("detail")).toHaveTextContent("finding F-0001");
    rerender(<Harness />);
    expect(screen.getByTestId("detail")).toBeEmptyDOMElement();
  });

  it("the inspector shows the most recently selected item: a finding, then a measurement", () => {
    const { rerender } = render(<Harness finding="F-0001" />);
    expect(screen.getByTestId("detail")).toHaveTextContent("finding F-0001");
    rerender(<Harness finding="F-0001" measurement="m-1" />);
    expect(screen.getByTestId("detail")).toHaveTextContent("measurement m-1");
    // another finding (picked on the stage) while the measurement stays selected
    rerender(<Harness finding="F-0002" measurement="m-1" />);
    expect(screen.getByTestId("detail")).toHaveTextContent("finding F-0002");
    rerender(<Harness measurement="m-1" />);
    expect(screen.getByTestId("detail")).toHaveTextContent("measurement m-1");
  });

  it("choosing the selected item again makes it the latest (a new selection key)", () => {
    const { rerender } = render(<Harness measurement="m-1#1" finding="F-0001#1" />);
    expect(screen.getByTestId("detail")).toHaveTextContent("finding F-0001#1");
    rerender(<Harness measurement="m-1#2" finding="F-0001#1" />);
    expect(screen.getByTestId("detail")).toHaveTextContent("measurement m-1#2");
  });
});
