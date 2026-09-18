import { describe, it, expect, vi } from "vitest";
import { History, type Command } from "./history";

function cmd(label: string, log: string[]): Command {
  return {
    label,
    undo: async () => {
      log.push(`undo ${label}`);
    },
    redo: async () => {
      log.push(`redo ${label}`);
    },
  };
}

describe("History", () => {
  it("undoes and redoes in order and clears redo on push", async () => {
    const log: string[] = [];
    const h = new History();
    h.push(cmd("a", log));
    h.push(cmd("b", log));
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
    expect((await h.undo())?.label).toBe("b");
    expect((await h.undo())?.label).toBe("a");
    expect(await h.undo()).toBeNull();
    expect((await h.redo())?.label).toBe("a");
    h.push(cmd("c", log));
    expect(h.canRedo()).toBe(false);
    expect(log).toEqual(["undo b", "undo a", "redo a"]);
  });

  it("keeps a failing command in place and rethrows", async () => {
    const h = new History();
    h.push({
      label: "bad",
      undo: async () => {
        throw new Error("nope");
      },
      redo: async () => {},
    });
    await expect(h.undo()).rejects.toThrow("nope");
    expect(h.canUndo()).toBe(true);
  });

  it("caps the stack and notifies subscribers with a version", async () => {
    const h = new History(2);
    const listener = vi.fn();
    h.subscribe(listener);
    const log: string[] = [];
    h.push(cmd("a", log));
    h.push(cmd("b", log));
    h.push(cmd("c", log));
    expect(h.version).toBe(3);
    expect(listener).toHaveBeenCalledTimes(3);
    await h.undo();
    await h.undo();
    expect(await h.undo()).toBeNull();
    expect(log).toEqual(["undo c", "undo b"]);
    h.clear();
    expect(h.canRedo()).toBe(false);
  });
});
