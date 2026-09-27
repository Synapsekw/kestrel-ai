import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderInWorkspace } from "../test/harness";
import { UTM33 } from "../test/fixtures";
import { InspectorHost } from "./InspectorHost";
import { registerInspector } from "./inspectorRegistry";

const offs: (() => void)[] = [];
afterEach(() => offs.splice(0).forEach((off) => off()));

describe("InspectorHost (spec §5.3 shell)", () => {
  it("is hidden with no selection, frames a framed kind in float glass, and positions an unframed one", () => {
    offs.push(
      registerInspector({
        id: "zone",
        label: "Zone",
        framed: true,
        Body: ({ selection }) => <p>zone {selection.id}</p>,
      }),
      registerInspector({
        id: "finding",
        label: "Finding",
        framed: false,
        Body: () => <aside aria-label="Own pane">x</aside>,
      }),
    );
    const { stores, container } = renderInWorkspace(<InspectorHost projectId="p1" frame={UTM33} />);
    expect(container).toBeEmptyDOMElement();

    act(() => stores.workspace.getState().select({ kind: "zone", id: "z1" }));
    const framed = screen.getByRole("complementary", { name: "Zone" });
    expect(framed).toHaveAttribute("data-glass", "float");
    expect(screen.getByText("zone z1")).toBeInTheDocument();

    act(() => stores.workspace.getState().select({ kind: "finding", id: "f1" }));
    expect(screen.getByRole("complementary", { name: "Own pane" }).closest("[data-glass]")).toBeNull();

    act(() => stores.workspace.getState().select({ kind: "unknown", id: "u" }));
    expect(container).toBeEmptyDOMElement();
  });
});
