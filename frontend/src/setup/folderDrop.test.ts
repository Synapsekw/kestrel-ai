import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAPPING, VERTICAL } from "@/test/setupFixtures";
import { pickFiles, pickFolders, subscribeFolderDrop } from "./folderDrop";

interface DropEvent {
  payload: { type: string; paths?: string[]; position?: { x: number; y: number } };
}

const tauri = vi.hoisted(() => ({
  inTauri: true,
  handler: null as null | ((e: DropEvent) => void),
  unlisten: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => tauri.inTauri }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (cb: (e: DropEvent) => void) => {
      tauri.handler = cb;
      return tauri.unlisten;
    },
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: tauri.open }));

describe("folder drop and pickers", () => {
  beforeEach(() => {
    tauri.inTauri = true;
    tauri.handler = null;
    tauri.unlisten.mockClear();
    tauri.open.mockReset();
  });

  it("reports hover and hands over the dropped paths", async () => {
    const onOver = vi.fn();
    const onDrop = vi.fn();
    subscribeFolderDrop({ onOver, onDrop });
    await vi.waitFor(() => expect(tauri.handler).not.toBeNull());
    tauri.handler!({ payload: { type: "enter", paths: ["E:\\DCIM"], position: { x: 1, y: 1 } } });
    tauri.handler!({ payload: { type: "leave" } });
    tauri.handler!({
      payload: { type: "drop", paths: ["E:\\DCIM", "E:\\Delivery"], position: { x: 1, y: 1 } },
    });
    expect(onOver.mock.calls).toEqual([[true], [false], [false]]);
    expect(onDrop).toHaveBeenCalledWith(["E:\\DCIM", "E:\\Delivery"]);
  });

  it("stops listening when the page leaves", async () => {
    const off = subscribeFolderDrop({ onOver: vi.fn(), onDrop: vi.fn() });
    await vi.waitFor(() => expect(tauri.handler).not.toBeNull());
    off();
    expect(tauri.unlisten).toHaveBeenCalledTimes(1);
  });

  it("never attaches when the page left before the shell answered", async () => {
    const off = subscribeFolderDrop({ onOver: vi.fn(), onDrop: vi.fn() });
    off();
    await vi.dynamicImportSettled();
    expect(tauri.handler).toBeNull();
  });

  it("does nothing outside the desktop shell", async () => {
    tauri.inTauri = false;
    subscribeFolderDrop({ onOver: vi.fn(), onDrop: vi.fn() });
    await vi.dynamicImportSettled();
    expect(tauri.handler).toBeNull();
  });

  it("picks folders for Browse folders and for a photo slot", async () => {
    tauri.open.mockResolvedValueOnce(["E:\\DCIM"]).mockResolvedValueOnce(null);
    expect(await pickFolders()).toEqual(["E:\\DCIM"]);
    expect(tauri.open).toHaveBeenCalledWith({ directory: true, multiple: true });
    expect(await pickFiles(VERTICAL.config.slots[0])).toEqual([]);
    expect(tauri.open).toHaveBeenLastCalledWith({ directory: true, multiple: true });
  });

  it("picks files of the slot's extensions for any other slot", async () => {
    tauri.open.mockResolvedValueOnce("E:\\Delivery\\ortho_q3.tif");
    expect(await pickFiles(MAPPING.config.slots[0])).toEqual(["E:\\Delivery\\ortho_q3.tif"]);
    expect(tauri.open).toHaveBeenCalledWith({
      multiple: true,
      filters: [{ name: "Orthomosaic", extensions: ["tif", "tiff"] }],
    });
  });
});
