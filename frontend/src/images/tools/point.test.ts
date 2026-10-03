import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleClasses } from "@/test/fixtures";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { POINT_TOOL } from "./point";
import type { ToolApi } from "./types";

const defect = { ...exampleClasses[0], id: "d", kind: "defect" as const };
const object = { ...exampleClasses[0], id: "o", kind: "object" as const };
const press = { image: { x: 10.04, y: 20.06 }, screen: { x: 0, y: 0 }, shift: false, alt: false, button: 0 };

let api: ToolApi;
beforeEach(() => {
  useImagesWorkspace.getState().reset();
  useImagesWorkspace.setState({ types: [defect, object] });
  api = {
    store: useImagesWorkspace,
    createShape: vi.fn(),
    holdShape: vi.fn(),
    createMeasurement: vi.fn(),
    openPicker: vi.fn(),
    notify: vi.fn(),
  };
});

describe("point marker (FC-R6)", () => {
  it("drops a point on a defect type", () => {
    useImagesWorkspace.setState({ activeTypeId: "d" });
    POINT_TOOL.onDown!(press, api);
    expect(api.createShape).toHaveBeenCalledWith({ shape: "point", x: 10, y: 20.1 });
  });

  it("opens the picker instead on an object type", () => {
    useImagesWorkspace.setState({ activeTypeId: "o" });
    POINT_TOOL.onDown!(press, api);
    expect(api.createShape).not.toHaveBeenCalled();
    expect(api.holdShape).toHaveBeenCalledWith({ shape: "point", x: 10, y: 20.1 });
    expect(api.notify).toHaveBeenCalledWith("Point markers need a defect. Pick one, or name a new anomaly.");
  });
});
