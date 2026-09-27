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

describe("History re-entrancy, queue and id aliases", () => {
  function slow(label: string, log: string[], ms = 20): Command {
    const wait = () => new Promise<void>((r) => setTimeout(r, ms));
    return {
      label,
      undo: async () => {
        await wait();
        log.push(`undo ${label}`);
      },
      redo: async () => {
        await wait();
        log.push(`redo ${label}`);
      },
    };
  }

  it("ignores a second undo or redo while one is in flight", async () => {
    const log: string[] = [];
    const h = new History();
    h.push(slow("a", log));
    h.push(slow("b", log));
    const first = h.undo();
    expect(await h.undo()).toBeNull();
    expect((await first)?.label).toBe("b");
    expect(log).toEqual(["undo b"]);
    const redo = h.redo();
    expect(await h.redo()).toBeNull();
    expect((await redo)?.label).toBe("b");
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
  });

  it("runs queued work one at a time in submission order, even when the first is slower", async () => {
    const h = new History();
    const log: string[] = [];
    const a = h.run(async () => {
      await new Promise((r) => setTimeout(r, 30));
      log.push("a");
      return "a";
    });
    const b = h.run(async () => {
      log.push("b");
      return "b";
    });
    expect(await Promise.all([a, b])).toEqual(["a", "b"]);
    expect(log).toEqual(["a", "b"]);
    await expect(
      h.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await h.run(async () => "after")).toBe("after");
  });

  it("resolves ids through the alias chain and clears it", () => {
    const h = new History();
    expect(h.resolve("x")).toBe("x");
    h.alias("a", "b");
    h.alias("b", "c");
    expect(h.resolve("a")).toBe("c");
    expect(h.resolve("b")).toBe("c");
    h.clear();
    expect(h.resolve("a")).toBe("a");
  });
});
