import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { exampleClasses, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { makeDetail, makeShape } from "@/images/canvas/testing";
import type { CommandContext } from "@/images/canvas/commands";
import { ensureBuiltInTools } from "./index";
import { TypePicker } from "./TypePicker";
import { rememberedType } from "./typeMemory";

const st = () => useImagesWorkspace.getState();
const crack = { ...exampleClasses[0], id: "crack", name: "Crack", kind: "defect" as const, hotkey: "1" };
const truck = { ...exampleClasses[1], id: "truck", name: "Truck", kind: "object" as const, hotkey: "2" };

function setup() {
  const { api, requests } = fakeClient([
    { method: "PATCH", path: /\/boxes\/b$/, body: (req) => ({ ...st().boxes.b, ...(req.body as object) }) },
  ]);
  const ctx: CommandContext = {
    api,
    projectId: PROJECT_ID,
    store: useImagesWorkspace,
    history: st().history,
  };
  render(
    <div className="relative">
      <TypePicker ctx={ctx} />
    </div>,
  );
  return { requests };
}

beforeEach(() => {
  ensureBuiltInTools();
  localStorage.clear();
  st().reset();
  useImagesWorkspace.setState({
    projectId: PROJECT_ID,
    types: [crack, truck],
    tool: "box",
    activeTypeId: "truck",
  });
  st().loadImage(makeDetail(), [makeShape({ id: "b", class_id: "crack" })], []);
});

describe("TypePicker (spec §9.2)", () => {
  it("sets the active type and remembers it for the tool", async () => {
    st().openPicker({ x: 40, y: 50 }, "active");
    setup();
    await userEvent.click(screen.getByRole("option", { name: /Crack/ }));
    expect(st().activeTypeId).toBe("crack");
    expect(rememberedType(PROJECT_ID, "box")).toBe("crack");
    expect(st().picker).toBeNull();
  });

  it("picks by a type's hotkey while open", async () => {
    st().openPicker({ x: 0, y: 0 }, "active");
    setup();
    await userEvent.keyboard("1");
    expect(st().activeTypeId).toBe("crack");
  });

  it("offers defect types only for the point tool", () => {
    useImagesWorkspace.setState({ tool: "point" });
    st().openPicker({ x: 0, y: 0 }, "active");
    setup();
    expect(screen.queryByRole("option", { name: /Truck/ })).toBeNull();
  });

  it("retypes the selection", async () => {
    st().select(["b"]);
    st().openPicker({ x: 0, y: 0 }, "retype");
    const { requests } = setup();
    await userEvent.click(screen.getByRole("option", { name: /Truck/ }));
    await waitFor(() => expect(requests.at(-1)?.body).toEqual({ class_id: "truck" }));
  });
});
