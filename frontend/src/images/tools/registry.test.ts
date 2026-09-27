import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleClasses, PROJECT_ID } from "@/test/fixtures";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { ensureBuiltInTools } from "./index";

// The shared fixture's classes are all objects; the tools need defects too.
const TYPES = [
  { ...exampleClasses[0], id: "obj", kind: "object" as const },
  { ...exampleClasses[1], id: "crack", kind: "defect" as const },
  { ...exampleClasses[2], id: "spall", kind: "defect" as const },
];
import { activateTool, getTool, listTools, registerTool, resetToolsForTests } from "./registry";
import { rememberType } from "./typeMemory";
import type { ToolApi } from "./types";

const api = (): ToolApi => ({
  store: useImagesWorkspace,
  createShape: vi.fn(),
  createMeasurement: vi.fn(),
  openPicker: vi.fn(),
  notify: vi.fn(),
});

beforeEach(() => {
  resetToolsForTests();
  ensureBuiltInTools();
  localStorage.clear();
  useImagesWorkspace.getState().reset();
  useImagesWorkspace.setState({ projectId: PROJECT_ID, types: TYPES, tool: "select", activeTypeId: null });
});

describe("tool registry", () => {
  it("lists the built-in tools in palette order", () => {
    expect(listTools().map((t) => t.id)).toEqual(["select", "pan", "box", "rbox", "polygon", "point", "length"]);
  });

  it("refuses a duplicate id or action", () => {
    expect(() => registerTool({ ...getTool("box")! })).toThrow(/already registered/);
    expect(() => registerTool({ ...getTool("box")!, id: "other" })).toThrow(/share the action/);
  });

  it("slots a new tool by order (FA's S at 55)", () => {
    registerTool({ ...getTool("polygon")!, id: "smart", action: "smart-polygon", order: 55 });
    expect(listTools().map((t) => t.id).indexOf("smart")).toBe(5);
  });

  it("restores the last type used with a tool", () => {
    rememberType(PROJECT_ID, "box", "spall");
    activateTool("box", api());
    expect(useImagesWorkspace.getState().activeTypeId).toBe("spall");
  });

  it("gives the point tool a defect type even when an object type is active", () => {
    useImagesWorkspace.setState({ activeTypeId: "obj" });
    activateTool("point", api());
    expect(useImagesWorkspace.getState().activeTypeId).toBe("crack");
  });

  it("does not switch to an unavailable tool and says why", () => {
    registerTool({ ...getTool("polygon")!, id: "smart", action: "smart-polygon", order: 55, available: () => "Get the model first" });
    const a = api();
    activateTool("smart", a);
    expect(useImagesWorkspace.getState().tool).toBe("select");
    expect(a.notify).toHaveBeenCalledWith("Get the model first");
  });

  it("runs the deactivate and activate hooks", () => {
    const onDeactivate = vi.fn();
    const onActivate = vi.fn();
    registerTool({ ...getTool("polygon")!, id: "smart", action: "smart-polygon", order: 55, onActivate, onDeactivate });
    const a = api();
    activateTool("smart", a);
    activateTool("box", a);
    expect(onActivate).toHaveBeenCalledOnce();
    expect(onDeactivate).toHaveBeenCalledOnce();
  });

  it("cancels the draft on a tool change", () => {
    useImagesWorkspace.getState().setDraft({ kind: "length", a: { x: 0, y: 0 }, b: null });
    activateTool("box", api());
    expect(useImagesWorkspace.getState().draft).toBeNull();
  });
});
