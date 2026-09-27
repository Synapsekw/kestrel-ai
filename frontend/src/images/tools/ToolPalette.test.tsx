import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { exampleClasses, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { makeDetail, makeShape } from "@/images/canvas/testing";
import type { CommandContext } from "@/images/canvas/commands";
import { ensureBuiltInTools } from "./index";
import { ToolPalette } from "./ToolPalette";

const st = () => useImagesWorkspace.getState();
const ctx = (): CommandContext => ({
  api: fakeClient([]).api,
  projectId: PROJECT_ID,
  store: useImagesWorkspace,
  history: st().history,
});

beforeEach(() => {
  ensureBuiltInTools();
  st().reset();
  useImagesWorkspace.setState({
    projectId: PROJECT_ID,
    types: [exampleClasses[0]],
    tool: "select",
    activeTypeId: exampleClasses[0].id,
  });
  st().loadImage(makeDetail(), [makeShape({ id: "b" })], []);
});

describe("ToolPalette", () => {
  it("lists the tools with their keys and marks the active one", () => {
    render(<ToolPalette ctx={ctx()} />);
    const box = screen.getByRole("button", { name: "Box" });
    expect(box).toHaveAttribute("aria-keyshortcuts", "B");
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches tools on click", async () => {
    render(<ToolPalette ctx={ctx()} />);
    await userEvent.click(screen.getByRole("button", { name: "Polygon" }));
    expect(st().tool).toBe("polygon");
  });

  it("enables Delete only with a selection", () => {
    const { rerender } = render(<ToolPalette ctx={ctx()} />);
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    st().select(["b"]);
    rerender(<ToolPalette ctx={ctx()} />);
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("shows the active type under the palette and opens the picker from it", async () => {
    render(<ToolPalette ctx={ctx()} />);
    await userEvent.click(screen.getByRole("button", { name: /Active type: excavator/ }));
    expect(st().picker?.purpose).toBe("active");
  });

  it("does not bind keys itself (the keymap does)", async () => {
    render(<ToolPalette ctx={ctx()} />);
    await userEvent.keyboard("b");
    expect(st().tool).toBe("select");
  });
});
