import { describe, it, expect } from "vitest";
import { collectPages } from "./paging";

describe("collectPages", () => {
  it("follows next_cursor until null", async () => {
    const pages: Record<string, { items: { id: string }[]; next_cursor: string | null }> = {
      first: { items: [{ id: "a" }, { id: "b" }], next_cursor: "c2" },
      c2: { items: [{ id: "c" }], next_cursor: null },
    };
    const calls: (string | undefined)[] = [];
    const items = await collectPages(async (cursor) => {
      calls.push(cursor);
      return pages[cursor ?? "first"];
    });
    expect(items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(calls).toEqual([undefined, "c2"]);
  });

  it("stops on a repeated cursor and dedupes by id (the mock answers next_cursor: 'string')", async () => {
    let calls = 0;
    const items = await collectPages(async () => {
      calls += 1;
      return { items: [{ id: "a" }], next_cursor: "string" };
    });
    expect(items).toEqual([{ id: "a" }]);
    expect(calls).toBe(2);
  });

  it("stops after maxPages", async () => {
    let n = 0;
    const items = await collectPages(async () => {
      n += 1;
      return { items: [{ id: `i${n}` }], next_cursor: `c${n}` };
    }, 3);
    expect(items).toHaveLength(3);
  });
});
