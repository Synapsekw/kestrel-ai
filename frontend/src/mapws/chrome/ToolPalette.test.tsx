import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeStores, renderInWorkspace } from "../test/harness";
import { LOCAL, UTM33 } from "../test/fixtures";
import { registerTool, toolRegistry, type MapTool } from "../tools/toolStore";
import { ToolPalette } from "./ToolPalette";

const offs: (() => void)[] = [];
afterEach(() => offs.splice(0).forEach((off) => off()));

const T = (t: Partial<MapTool> & Pick<MapTool, "id" | "action" | "group">): MapTool => ({
  topic: "measure",
  order: 0,
  icon: "measure",
  label: t.id,
  hint: "",
  draw: { shape: "none" },
  ...t,
});

function setup(frame = UTM33) {
  offs.push(
    registerTool(
      T({
        id: "select",
        action: "tool-select",
        group: "navigate",
        label: "Select",
      }),
    ),
    registerTool(
      T({
        id: "pan",
        action: "tool-pan",
        group: "navigate",
        order: 1,
        label: "Pan",
      }),
    ),
    registerTool(
      T({
        id: "distance",
        action: "measure-length",
        group: "measure",
        label: "Measure distance",
        draw: { shape: "line", min: 2 },
      }),
    ),
    registerTool(
      T({
        id: "finding-point",
        action: "finding-marker",
        group: "annotate",
        label: "Add finding point",
        disabledReason: (ctx) => (ctx.frame.kind === "local" ? "Findings need a map with coordinates" : null),
      }),
    ),
    registerTool(
      T({
        id: "typo",
        action: "measure-lenght",
        group: "site",
        label: "Typo tool",
      }),
    ),
  );
  const stores = makeStores({ frame, lookup: (id) => toolRegistry.get(id) });
  renderInWorkspace(<ToolPalette context={{ frame, selection: null, surveys: [], layers: [], r: null }} />, {
    stores,
  });
  return stores;
}

describe("ToolPalette (spec §5.1)", () => {
  it("shows the registered tools in their groups with Select active", () => {
    setup();
    const bar = screen.getByRole("toolbar", { name: "Map tools" });
    expect(bar).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("separator")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Measure distance" })).toHaveAttribute(
      "aria-keyshortcuts",
      "L",
    );
  });

  it("switches tools by click and by key, and V and H reach Select and Pan", () => {
    const stores = setup();
    fireEvent.keyDown(window, { key: "l" });
    expect(stores.tools.getState().active).toBe("distance");
    fireEvent.keyDown(window, { key: "h" });
    expect(stores.tools.getState().active).toBe("pan");
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(stores.tools.getState().active).toBe("select");
  });

  it("disables a tool with its reason, and its key does nothing", () => {
    const stores = setup(LOCAL);
    const button = screen.getByRole("button", {
      name: /Add finding point — Findings need a map with coordinates/,
    });
    expect(button).toBeDisabled();
    fireEvent.keyDown(window, { key: "m" });
    expect(stores.tools.getState().active).toBe("select");
  });

  it("gives a tool with an unknown action no key (Review Focus 3)", () => {
    setup();
    expect(screen.getByRole("button", { name: "Typo tool" })).not.toHaveAttribute("aria-keyshortcuts");
  });

  it("ignores tool keys typed into a field", () => {
    const stores = setup();
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "l" });
    input.remove();
    expect(stores.tools.getState().active).toBe("select");
  });
});
